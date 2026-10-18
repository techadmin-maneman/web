// The nightly reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md, 0196-long-work-in-workflows.md): D1's
// visits and payments, and the tables they are grouped by, written to the analytics schema that Zoho Analytics reads.
// The night is worked in parts, each a step of the Workflow that runs it (src/workflows/analytics-copy.ts): each part
// works out its tables and stages them beside the copy, and the last swaps every staged table in, in one transaction,
// an unchanged row keeping its stamp so Zoho fetches only what changed. The copy's totals are then checked against
// what was sent, and the run logged in the copy itself.

import { addDays } from "../../lib/india-time.ts";
import { LOST_AFTER_DAYS, type StandingRules } from "../../policy/client-standing.ts";
import { NEXT_VISIT_DAYS } from "../../policy/next-visit.ts";
import type { RunLog, TableMeta, TableRows, WarehouseProvider } from "../../providers/warehouse/index.ts";
import { capacityRows, CAPACITY_DAYS_AHEAD } from "./capacity.ts";
import { careCaseRows } from "./care-cases.ts";
import { BOOKING_RULES } from "../../policy/start-times.ts";
import { accessRows } from "./access.ts";
import { clientKeys } from "./client-key.ts";
import { clientMonthRows } from "./client-months.ts";
import { creditRows } from "./credits.ts";
import { leadTables } from "./leads.ts";
import { messageDayRows } from "./message-days.ts";
import { areaRows, pieceRows } from "./pieces.ts";
import { spendRows } from "./spend.ts";
import { stockTables } from "./stock.ts";
import { targetRows } from "./targets.ts";
import { cityRows, clientRows, dateRows, paymentRows, serviceRows, technicianRows, visitRows } from "./rows.ts";

/** The free plan holds 500 MB of Postgres; told at 400, so there is time to trim or upgrade. */
export const WAREHOUSE_ALERT_BYTES = 400 * 1024 * 1024;

/** The figures that stand until ops set others. */
const COMMITTED_STANDING: StandingRules = {
  grace: NEXT_VISIT_DAYS.at_risk_after_due,
  lostAfter: LOST_AFTER_DAYS,
};

/** The calendar runs a year past tonight, so a visit booked months ahead has its week and quarter. */
const DAYS_AHEAD = 365;

/** What a night is given: the key clients are named by, India's date it is for, its clock, and ops' standing days. */
export interface NightGiven {
  readonly secret: string;
  readonly date: string;
  readonly now: () => Date;
  /** The grace after a service falls due and the days to lost, as ops set them. */
  readonly standing?: StandingRules;
  /** The arrival window after a start, in minutes, which a visit on time is checked in by; left out, booking's own. */
  readonly arrivalMinutes?: number;
}

/** What a night's parts read of D1, each the first time one asks, so a part reads only what its tables need. */
function nightOf(db: D1Database, warehouse: WarehouseProvider, given: NightGiven) {
  const once = <T>(work: () => Promise<T>) => {
    let made: Promise<T> | undefined;
    return () => (made ??= work());
  };
  const { date } = given;
  const keys = once(async () => {
    const { results: people } = await db
      .prepare("SELECT id FROM people WHERE test_record = 0 AND erased_at IS NULL")
      .all<{ id: string }>();
    return clientKeys(
      given.secret,
      people.map((person) => person.id),
    );
  });
  const visits = once(async () => visitRows(db, await keys(), given.arrivalMinutes ?? BOOKING_RULES.arrival));
  const payments = once(async () => paymentRows(db, await keys()));
  // The first day with a visit or a payment, which the calendar and the first night's capacity start from.
  const first = once(async () => {
    const days = [
      ...(await visits()).rows.map((row) => row.visit_date),
      ...(await payments()).rows.map((row) => row.payment_date),
    ];
    return days.filter((day) => typeof day === "string").sort()[0] ?? date;
  });
  const technicians = once(() => technicianRows(db));
  const cities = once(() => cityRows(db));
  const leads = once(async () =>
    leadTables(
      db,
      await keys(),
      (await cities()).rows.map((row) => String(row.city)),
    ),
  );
  const capacity = once(async () => {
    const technicianCities = new Map(
      (await technicians()).rows.map((row) => [
        String(row.technician_key),
        typeof row.city === "string" ? row.city : null,
      ]),
    );
    // The first night fills every day since the first visit; each night after rewrites yesterday on.
    const yesterday = addDays(date, -1);
    const start = await first();
    const since = (await warehouse.count("fact_capacity")) === 0 && start < yesterday ? start : yesterday;
    return capacityRows(db, technicianCities, {
      from: since,
      to: addDays(date, CAPACITY_DAYS_AHEAD),
      now: given.now(),
    });
  });
  const standing = given.standing ?? COMMITTED_STANDING;
  return { db, date, standing, keys, visits, payments, first, technicians, cities, leads, capacity };
}

type Night = ReturnType<typeof nightOf>;

/** A part of the night: its name, and the tables it works out. */
interface NightPart {
  readonly name: string;
  readonly tables: (night: Night) => Promise<readonly TableRows[]>;
}

const one = (rows: Promise<TableRows>) => rows.then((table) => [table]);

/** The night's parts, in the order they are staged; each is a step of its own, tried again on its own. */
export const NIGHT_PARTS: readonly NightPart[] = [
  {
    name: "dates",
    tables: async (night) => [dateRows(min(await night.first(), night.date), addDays(night.date, DAYS_AHEAD))],
  },
  { name: "cities", tables: (night) => one(night.cities()) },
  { name: "technicians", tables: (night) => one(night.technicians()) },
  { name: "services", tables: (night) => one(serviceRows(night.db)) },
  {
    name: "clients",
    tables: async (night) => [await clientRows(night.db, await night.keys(), (await night.leads()).firstTouch)],
  },
  { name: "visits", tables: (night) => one(night.visits()) },
  { name: "payments", tables: (night) => one(night.payments()) },
  { name: "capacity", tables: (night) => one(night.capacity()) },
  { name: "leads", tables: async (night) => (await night.leads()).tables },
  { name: "message_days", tables: (night) => one(messageDayRows(night.db)) },
  { name: "care_cases", tables: (night) => one(careCaseRows(night.db)) },
  { name: "spend", tables: (night) => one(spendRows(night.db)) },
  {
    name: "client_months",
    tables: async (night) => [
      await clientMonthRows(night.db, {
        keys: await night.keys(),
        firstTouch: (await night.leads()).firstTouch,
        days: night.standing,
        today: night.date,
      }),
    ],
  },
  { name: "credits", tables: async (night) => [await creditRows(night.db, await night.keys())] },
  { name: "stock", tables: (night) => stockTables(night.db, night.date) },
  { name: "access", tables: (night) => one(accessRows(night.db)) },
  { name: "targets", tables: (night) => one(targetRows(night.db)) },
  { name: "pieces", tables: async (night) => [await pieceRows(night.db, await night.keys())] },
  { name: "areas", tables: (night) => one(areaRows(night.db)) },
];

const min = (one: string, other: string) => (one < other ? one : other);

/** The run's name in load_rows: one night's copy is one run, however often a part is tried. */
const runOf = (date: string) => `night ${date}`;

/** Works out one part's tables and stages them; their shapes, for the swap. */
export async function stagePart(
  db: D1Database,
  warehouse: WarehouseProvider,
  { part, given }: { readonly part: NightPart; readonly given: NightGiven },
): Promise<TableMeta[]> {
  const tables = await part.tables(nightOf(db, warehouse, given));
  const staged: TableMeta[] = [];
  for (const table of tables) staged.push(await warehouse.stage(runOf(given.date), table));
  return staged;
}

/** Whether the copy holds every visit sent, and the payments' takings to the paisa. */
async function totalsMatch(warehouse: WarehouseProvider, staged: readonly TableMeta[]): Promise<boolean> {
  const visits = staged.find((table) => table.table === "fact_visit");
  const payments = staged.find((table) => table.table === "fact_payment");
  const held = await warehouse.count("fact_visit");
  const taken = Math.round((await warehouse.sum("fact_payment", "amount")) * 100);
  return held === (visits?.rows ?? 0) && taken === (payments?.amountPaise ?? 0);
}

/** Swaps every staged table in, checks the copy's totals, and logs the run. */
export async function finishNight(
  warehouse: WarehouseProvider,
  {
    staged,
    given,
    startedAt,
  }: { readonly staged: readonly TableMeta[]; readonly given: NightGiven; readonly startedAt: Date },
): Promise<RunLog> {
  const { written, changed } = await warehouse.swap(runOf(given.date), staged);
  const totalsChecked = await totalsMatch(warehouse, staged);
  const run: RunLog = {
    startedAt,
    endedAt: given.now(),
    date: given.date,
    rowsWritten: written,
    rowsChanged: changed,
    totalsChecked,
    databaseBytes: await warehouse.size(),
    notes: totalsChecked ? null : "the copy's totals differ from what was sent",
  };
  await warehouse.logRun(run);
  return run;
}

/** The whole night in one pass, every part then the swap: for a run outside the Workflow. */
export async function copyTonight(db: D1Database, warehouse: WarehouseProvider, given: NightGiven): Promise<RunLog> {
  const startedAt = given.now();
  const staged: TableMeta[] = [];
  for (const part of NIGHT_PARTS) staged.push(...(await stagePart(db, warehouse, { part, given })));
  return finishNight(warehouse, { staged, given, startedAt });
}

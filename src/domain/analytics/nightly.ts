// The nightly reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): in the hour from 3 am in India, D1's
// visits and payments, and the tables they are grouped by, written to the analytics schema that Zoho Analytics reads.
// Each table is made to hold exactly tonight's rows, an unchanged row keeping its stamp so Zoho fetches only what
// changed. The copy's totals are then checked against what was sent, and the run logged in the copy itself.

import { addDays, indiaDate, indiaHour } from "../../lib/india-time.ts";
import { LOST_AFTER_DAYS, type StandingDays } from "../../policy/client-standing.ts";
import { NEXT_VISIT_DAYS } from "../../policy/next-visit.ts";
import type { RunLog, TableRows, WarehouseProvider } from "../../providers/warehouse/index.ts";
import { capacityRows, CAPACITY_DAYS_AHEAD } from "./capacity.ts";
import { careCaseRows } from "./care-cases.ts";
import { clientKeys } from "./client-key.ts";
import { clientMonthRows } from "./client-months.ts";
import { leadTables } from "./leads.ts";
import { messageDayRows } from "./message-days.ts";
import { spendRows } from "./spend.ts";
import { cityRows, clientRows, dateRows, paymentRows, serviceRows, technicianRows, visitRows } from "./rows.ts";

/** The free plan holds 500 MB of Postgres; told at 400, so there is time to trim or upgrade. */
export const WAREHOUSE_ALERT_BYTES = 400 * 1024 * 1024;

/** The figures that stand until ops set others. */
const COMMITTED_STANDING: StandingDays = {
  cadence: NEXT_VISIT_DAYS.service_cadence,
  grace: NEXT_VISIT_DAYS.at_risk_after_due,
  lostAfter: LOST_AFTER_DAYS,
};

/** The calendar runs a year past tonight, so a visit booked months ahead has its week and quarter. */
const DAYS_AHEAD = 365;

/** India's date in the hour from 3 am, when the copy is due; null in every other hour. */
export function nightlyDueOn(now: Date): string | null {
  return indiaHour(now).endsWith("T03") ? indiaDate(now) : null;
}

const total = (table: TableRows, column: string) =>
  Math.round(table.rows.reduce((sum, row) => sum + Number(row[column] ?? 0), 0) * 100);

/** Whether the copy holds every visit sent, and the payments' takings to the paisa. */
async function totalsMatch(warehouse: WarehouseProvider, visits: TableRows, payments: TableRows): Promise<boolean> {
  const held = await warehouse.count("fact_visit");
  const taken = Math.round((await warehouse.sum("fact_payment", "amount")) * 100);
  return held === visits.rows.length && taken === total(payments, "amount");
}

export async function copyTonight(
  db: D1Database,
  warehouse: WarehouseProvider,
  {
    secret,
    date,
    now,
    standing = COMMITTED_STANDING,
  }: {
    readonly secret: string;
    readonly date: string;
    readonly now: () => Date;
    /** The service cadence, its grace and the days to lost, as ops set them. */
    readonly standing?: StandingDays;
  },
): Promise<RunLog> {
  const startedAt = now();
  const { results: people } = await db
    .prepare("SELECT id FROM people WHERE test_record = 0 AND erased_at IS NULL")
    .all<{ id: string }>();
  const keys = await clientKeys(
    secret,
    people.map((person) => person.id),
  );
  const visits = await visitRows(db, keys);
  const payments = await paymentRows(db, keys);
  const days = [...visits.rows.map((row) => row.visit_date), ...payments.rows.map((row) => row.payment_date)];
  const first = days.filter((day) => typeof day === "string").sort()[0] ?? date;
  const yesterday = addDays(date, -1);
  const technicians = await technicianRows(db);
  const technicianCities = new Map(
    technicians.rows.map((row) => [String(row.technician_key), typeof row.city === "string" ? row.city : null]),
  );
  const cities = await cityRows(db);
  const leads = await leadTables(
    db,
    keys,
    cities.rows.map((row) => String(row.city)),
  );
  // The first night fills every day since the first visit; each night after rewrites yesterday on.
  const since = (await warehouse.count("fact_capacity")) === 0 && first < yesterday ? first : yesterday;
  const tables = [
    dateRows(first < date ? first : date, addDays(date, DAYS_AHEAD)),
    cities,
    technicians,
    await serviceRows(db),
    await clientRows(db, keys, leads.firstTouch),
    visits,
    payments,
    await capacityRows(db, technicianCities, { from: since, to: addDays(date, CAPACITY_DAYS_AHEAD), now: startedAt }),
    await messageDayRows(db),
    await careCaseRows(db),
    ...leads.tables,
    await spendRows(db),
    await clientMonthRows(db, { keys, firstTouch: leads.firstTouch, days: standing, today: date }),
  ];
  let rowsWritten = 0;
  let rowsChanged = 0;
  for (const table of tables) {
    const { written, changed } = await warehouse.replace(table);
    rowsWritten += written;
    rowsChanged += changed;
  }
  const totalsChecked = await totalsMatch(warehouse, visits, payments);
  const run: RunLog = {
    startedAt,
    endedAt: now(),
    date,
    rowsWritten,
    rowsChanged,
    totalsChecked,
    databaseBytes: await warehouse.size(),
    notes: totalsChecked ? null : "the copy's totals differ from what was sent",
  };
  await warehouse.logRun(run);
  return run;
}

// What each city has done towards a month's targets, for the Targets page (docs/decisions/0317-targets-progress.md):
// each measure counted as the Funnel (./acquisition.ts) and the reporting copy (./rows.ts, ./capacity.ts) count it,
// so the page and the dashboards agree. Records marked as tests are left out.
//
// - Leads: the clients whose first lead came in the month, in that lead's city.
// - Consultations done and new clients: the consultations done and first fits paid in the month, in the visit's city
//   and the payment's.
// - Active clients: today's, as Cities counts them; this month's alone, as a month gone has no count kept.
// - Revenue: what was paid in the month, before GST and less what was refunded, in the payment's city.
// - Acquisition cost: the spend entered for the city in the month, over its new clients.
// - Utilisation: of the half-slots its technicians had open on the month's days to today, those taken. It counts
//   today's active technicians in today's cities, so a month whose roster changed can differ from the copy's figure.
// - On time: of its visits done in the month, those checked in by the end of the arrival window.

import { addDays, addMonths, indiaDate, indiaInstant, monthOf } from "../../lib/india-time.ts";
import { TARGET_MEASURE_NAMES, type TargetMeasure } from "../../policy/targets.ts";
import { NET } from "./acquisition.ts";
import { capacityRows } from "./capacity.ts";
import { activeClientsBy } from "../clients/active-clients.ts";
import type { StageDays } from "../clients/client-stage.ts";
import { paymentCityOf, visitCity } from "../clients/places.ts";

export interface Progress {
  readonly city: string;
  readonly measure: TargetMeasure;
  /** A count, whole rupees before GST, or a percentage, as the target is; null where there is nothing to count by. */
  readonly actual: number | null;
}

interface Asked {
  readonly month: string;
  readonly now: Date;
  /** The arrival window after a start, as booking sets it, by whose end a check-in is on time. */
  readonly arrivalMinutes: number;
  readonly days: StageDays;
}

type ByCity = ReadonlyMap<string, number>;

interface Range {
  /** The month's first and next month's first instants. */
  readonly from: string;
  readonly to: string;
  /** The month's first day, and the last day counted: today for this month. */
  readonly firstDay: string;
  readonly lastDay: string;
}

async function byCity(db: D1Database, sql: string, ...binds: readonly unknown[]): Promise<ByCity> {
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ city: string | null; n: number | null }>();
  return new Map(results.flatMap((row) => (row.city === null ? [] : [[row.city, row.n ?? 0] as const])));
}

const LEADS = `SELECT (SELECT l.city FROM leads l WHERE l.person_id = f.person_id ORDER BY l.created_at LIMIT 1) AS city,
    COUNT(*) AS n
  FROM (SELECT l.person_id, MIN(l.created_at) AS first_at FROM leads l JOIN people p ON p.id = l.person_id
        WHERE p.test_record = 0 GROUP BY l.person_id) f
  WHERE f.first_at >= ?1 AND f.first_at < ?2 GROUP BY 1`;

/** The clients a milestone came to in the range, by the city `city` finds for its subject. */
const milestone = (event: "consult_done" | "first_fit_paid", city: string) =>
  `SELECT ${city} AS city, COUNT(DISTINCT c.person_id) AS n FROM conversions c JOIN people p ON p.id = c.person_id
   WHERE p.test_record = 0 AND c.event = '${event}' AND c.occurred_at >= ?1 AND c.occurred_at < ?2 GROUP BY 1`;

const CONSULTATIONS = milestone(
  "consult_done",
  `(SELECT ${visitCity("v")} FROM appointments v WHERE v.id = c.subject_id)`,
);

const FIRST_FITS = milestone(
  "first_fit_paid",
  `(SELECT ${paymentCityOf("y")} FROM payments y WHERE y.id = c.subject_id)`,
);

/** Paise, as `NET` reads a payment. */
const REVENUE = `SELECT ${paymentCityOf("y")} AS city, SUM(${NET}) AS n FROM payments y JOIN people p ON p.id = y.person_id
  WHERE p.test_record = 0 AND y.amount > 0 AND y.captured_at >= ?1 AND y.captured_at < ?2 GROUP BY 1`;

/** Paise; an entry made for a whole month on its first day, as the Funnel counts it. */
const SPEND = `SELECT city, SUM(amount) AS n FROM spend_entries
  WHERE removed_at IS NULL AND city IS NOT NULL
    AND COALESCE(spent_date, month || '-01') >= ?1 AND COALESCE(spent_date, month || '-01') <= ?2
  GROUP BY city`;

/** A visit done, and whether it was on time, as the reporting copy's `is_on_time` (./rows.ts). */
const VISITS = `SELECT ${visitCity("a")} AS city, COUNT(*) AS n,
    SUM(EXISTS (SELECT 1 FROM checkins c WHERE c.appointment_id = a.id AND c.passed = 1
      AND c.at <= strftime('%Y-%m-%dT%H:%M:%fZ', a.window_start, '+' || ?3 || ' minutes'))) AS on_time
  FROM appointments a JOIN people p ON p.id = a.person_id
  WHERE a.deleted_at IS NULL AND a.status = 'completed' AND p.test_record = 0
    AND a.window_start >= ?1 AND a.window_start < ?2
  GROUP BY 1`;

async function onTime(db: D1Database, range: Range, arrivalMinutes: number): Promise<ByCity> {
  const { results } = await db
    .prepare(VISITS)
    .bind(range.from, range.to, arrivalMinutes)
    .all<{ city: string | null; n: number; on_time: number }>();
  return new Map(
    results.flatMap((row) => (row.city === null ? [] : [[row.city, percent(row.on_time, row.n)] as const])),
  );
}

/** Each city's technicians' half-slots on the range's days, taken of those open, from the board as the copy reads it. */
async function utilisation(db: D1Database, range: Range, now: Date): Promise<ByCity> {
  const { results } = await db
    .prepare("SELECT id, city FROM technicians WHERE test_record = 0")
    .all<{ id: string; city: string | null }>();
  const cities = new Map(results.map((row) => [row.id, row.city]));
  const { rows } = await capacityRows(db, cities, { from: range.firstDay, to: range.lastDay, now });
  const slots = new Map<string, { open: number; taken: number }>();
  for (const row of rows) {
    if (typeof row.city !== "string" || typeof row.day !== "string" || row.day < range.firstDay) continue;
    const held = slots.get(row.city) ?? { open: 0, taken: 0 };
    slots.set(row.city, {
      open: held.open + Number(row.half_slots_open),
      taken: held.taken + Number(row.half_slots_taken),
    });
  }
  return new Map(
    [...slots].flatMap(([city, { open, taken }]) => (open === 0 ? [] : [[city, percent(taken, open)] as const])),
  );
}

const percent = (part: number, whole: number) => Math.round((part * 100) / whole);
const rupees = (paise: number) => Math.round(paise / 100);

/** Every city's figure for every measure; the month's own to date, nothing for a month still to come. */
export async function targetProgress(db: D1Database, asked: Asked): Promise<Progress[]> {
  const { results: cityRows } = await db.prepare("SELECT name FROM cities ORDER BY sort").all<{ name: string }>();
  const cities = cityRows.map((row) => row.name);
  const today = indiaDate(asked.now);
  const thisMonth = monthOf(today);
  const next = `${addMonths(asked.month, 1)}-01`;
  const range: Range = {
    from: indiaInstant(`${asked.month}-01`, "00:00").toISOString(),
    to: indiaInstant(next, "00:00").toISOString(),
    firstDay: `${asked.month}-01`,
    lastDay: asked.month === thisMonth ? today : addDays(next, -1),
  };
  if (asked.month > thisMonth) {
    return cities.flatMap((city) => TARGET_MEASURE_NAMES.map((measure) => ({ city, measure, actual: null })));
  }
  const [leads, consultations, newClients, paid, spent, onTimeShare, used, active] = await Promise.all([
    byCity(db, LEADS, range.from, range.to),
    byCity(db, CONSULTATIONS, range.from, range.to),
    byCity(db, FIRST_FITS, range.from, range.to),
    byCity(db, REVENUE, range.from, range.to),
    byCity(db, SPEND, range.firstDay, range.lastDay),
    onTime(db, range, asked.arrivalMinutes),
    utilisation(db, range, asked.now),
    asked.month === thisMonth ? activeClientsBy(db, "city", asked.days) : null,
  ]);
  const figureOf = (measure: TargetMeasure, city: string): number | null => {
    switch (measure) {
      case "leads":
        return leads.get(city) ?? 0;
      case "consultations":
        return consultations.get(city) ?? 0;
      case "new_clients":
        return newClients.get(city) ?? 0;
      case "active_clients":
        return active === null ? null : (active.get(city) ?? 0);
      case "revenue":
        return rupees(paid.get(city) ?? 0);
      case "cac": {
        const spend = spent.get(city);
        const clients = newClients.get(city) ?? 0;
        return spend === undefined || clients === 0 ? null : rupees(spend / clients);
      }
      case "utilisation":
        return used.get(city) ?? null;
      case "on_time":
        return onTimeShare.get(city) ?? null;
    }
  };
  return cities.flatMap((city) =>
    TARGET_MEASURE_NAMES.map((measure) => ({ city, measure, actual: figureOf(measure, city) })),
  );
}

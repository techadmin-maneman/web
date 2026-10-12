// A row per client per month in the reporting copy (docs/decisions/0151-retention-figures.md), from the month of their
// first fitting: where they stood at its end (src/policy/client-standing.ts), the visits done in it and the revenue
// they earned, in the city of their first fit and under their first lead's channel. Revenue is before GST and after
// refunds, earned on the day of the visit. The current month stands as of tonight. Records marked as tests are left out.

import { addDays, addMonths, indiaDate, monthOf } from "../../lib/india-time.ts";
import { standingOn, type StandingDays } from "../../policy/client-standing.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import type { FirstTouch } from "./leads.ts";

interface VisitRow {
  readonly person_id: string;
  readonly window_start: string;
  readonly city: string | null;
  readonly fitting: number;
  readonly earned: number;
}

interface Visit {
  readonly day: string;
  readonly fitting: boolean;
  readonly earned: number;
}

/** Each visit done, the oldest first, with whether it was a fitting and what its payments came to less refunds. */
const VISITS_DONE = `SELECT a.person_id, a.window_start, a.service_city AS city,
    a.type IN ('first_fit', 'service', 'replacement') AS fitting,
    (SELECT COALESCE(SUM(COALESCE(y.amount_ex_gst, y.amount) * (y.amount - y.refunded_amount) / y.amount), 0)
       FROM payments y WHERE y.appointment_id = a.id AND y.captured_at IS NOT NULL AND y.amount > 0) AS earned
  FROM appointments a JOIN people p ON p.id = a.person_id
  WHERE a.status = 'completed' AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
    AND p.test_record = 0 AND p.erased_at IS NULL
  ORDER BY a.person_id, a.window_start`;

const lastDayOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** One client's months, from the month of their first fitting to tonight's. */
function monthsOf(visits: readonly Visit[], firstCity: string | null, today: string, days: StandingDays) {
  const fittings = visits.filter((visit) => visit.fitting);
  const first = fittings[0];
  if (first === undefined) return [];
  const months: { month: string; state: string; visits: number; revenue: number; city: string | null }[] = [];
  for (let month = monthOf(first.day); month <= monthOf(today); month = addMonths(month, 1)) {
    const end = lastDayOf(month) < today ? lastDayOf(month) : today;
    const last = fittings.filter((visit) => visit.day <= end).at(-1) ?? first;
    const inMonth = visits.filter((visit) => monthOf(visit.day) === month);
    months.push({
      month,
      state: standingOn(end, last.day, days),
      visits: inMonth.length,
      revenue: Math.round(inMonth.reduce((sum, visit) => sum + visit.earned, 0)) / 100,
      city: firstCity,
    });
  }
  return months;
}

export async function clientMonthRows(
  db: D1Database,
  input: {
    readonly keys: ReadonlyMap<string, string>;
    readonly firstTouch: ReadonlyMap<string, FirstTouch>;
    readonly days: StandingDays;
    readonly today: string;
  },
): Promise<TableRows> {
  const { results } = await db.prepare(VISITS_DONE).all<VisitRow>();
  const byPerson = new Map<string, { visits: Visit[]; city: string | null }>();
  for (const row of results) {
    const held = byPerson.get(row.person_id) ?? { visits: [], city: null };
    const visit = { day: indiaDate(new Date(row.window_start)), fitting: row.fitting === 1, earned: row.earned };
    if (visit.fitting && held.visits.every((each) => !each.fitting)) held.city = row.city;
    held.visits.push(visit);
    byPerson.set(row.person_id, held);
  }
  const rows: Row[] = [];
  for (const [personId, held] of byPerson) {
    const key = input.keys.get(personId);
    if (key === undefined) continue;
    const months = monthsOf(held.visits, held.city, input.today, input.days);
    const cohort = months[0]?.month;
    for (const month of months) {
      rows.push({
        month: `${month.month}-01`,
        client_key: key,
        city: month.city,
        channel: input.firstTouch.get(key)?.channel ?? "Direct",
        cohort_month: cohort === undefined ? null : `${cohort}-01`,
        state: month.state,
        visits: month.visits,
        revenue: month.revenue,
        margin: null,
      });
    }
  }
  return { table: "fact_client_month", key: ["month", "client_key"], stamped: true, rows };
}

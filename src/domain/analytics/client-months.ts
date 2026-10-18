// A row per client per month in the reporting copy (docs/decisions/0151-retention-figures.md), from the month of their
// first fitting, which is "new": where they stood at each later month's end (src/policy/client-standing.ts), the visits done in it and the revenue
// they earned, in the city of their first fit and under their first lead's channel. Revenue is before GST and after
// refunds, earned on the day of the visit. Margin is revenue less each visit's hair system at its standard cost
// (docs/decisions/0152-standard-costs.md), the consumables used at their recorded cost, and the technician's rate for
// the visit; a month with a fitting whose product has no cost set has none. The current month stands as of tonight.
// Records marked as tests are left out.

import { addDays, addMonths, indiaDate, indiaDateSql, monthOf } from "../../lib/india-time.ts";
import { standingOn, type StandingDays, type StandingRules } from "../../policy/client-standing.ts";
import { everyDaysSql } from "../booking/packages.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import type { FirstTouch } from "./leads.ts";
import { tierOf } from "../../config/visit-types.ts";

interface VisitRow {
  readonly person_id: string;
  readonly window_start: string;
  readonly city: string | null;
  readonly fitting: number;
  readonly earned: number;
  /** The visit's costs in paise; null where its hair system has no standard cost set. */
  readonly cost: number | null;
  /** Days from a fitting to the client's next service, by their package. */
  readonly every: number;
}

interface Visit {
  readonly day: string;
  readonly fitting: boolean;
  readonly earned: number;
  readonly cost: number | null;
}

const ON_ITS_DAY = indiaDateSql("a.window_start");

/** The technician's rate for the visit: their grade's for its city, else for every city, from the rate in force. */
const rateFor = (
  city: string,
) => `(SELECT r.amount FROM visit_pay_rates r JOIN technicians t ON t.pay_grade_id = r.grade_id
    WHERE t.id = a.technician_id AND r.visit_kind = a.type AND ${city} AND r.effective_from <= ${ON_ITS_DAY}
    ORDER BY r.effective_from DESC LIMIT 1)`;

/** What the visit cost us: its hair system on a first fit or replacement, the consumables used, and the visit's pay. */
const COST = `(CASE WHEN a.type IN ('first_fit', 'replacement') THEN
      (SELECT c.cost FROM standard_costs c WHERE c.item = a.type AND c.tier = ${tierOf("a.tier")}
         AND c.valid_from <= ${ON_ITS_DAY} ORDER BY c.valid_from DESC LIMIT 1)
    ELSE 0 END)
    + (SELECT COALESCE(SUM(u.quantity * COALESCE(u.unit_cost, 0)), 0) FROM consumables_used u WHERE u.appointment_id = a.id)
    + COALESCE(${rateFor("r.city = a.service_city")}, ${rateFor("r.city IS NULL")}, 0)`;

/** Each visit done, the oldest first, with whether it was a fitting and what its payments came to less refunds. */
const VISITS_DONE = `SELECT a.person_id, a.window_start, a.service_city AS city,
    a.type IN ('first_fit', 'service', 'replacement') AS fitting,
    (SELECT COALESCE(SUM(COALESCE(y.amount_ex_gst, y.amount) * (y.amount - y.refunded_amount) / y.amount), 0)
       FROM payments y WHERE y.appointment_id = a.id AND y.captured_at IS NOT NULL AND y.amount > 0) AS earned,
    ${COST} AS cost, ${everyDaysSql("p.package")} AS every
  FROM appointments a JOIN people p ON p.id = a.person_id
  WHERE a.status = 'completed' AND a.deleted_at IS NULL AND a.window_start IS NOT NULL
    AND p.test_record = 0 AND p.erased_at IS NULL
  ORDER BY a.person_id, a.window_start`;

const lastDayOf = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** What the visits earned less what they cost, in rupees; null where a visit's cost is not known. */
function marginOf(visits: readonly Visit[]): number | null {
  if (visits.some((visit) => visit.cost === null)) return null;
  return Math.round(visits.reduce((sum, visit) => sum + visit.earned - (visit.cost ?? 0), 0)) / 100;
}

/** One client's months, from the month of their first fitting to tonight's. */
function monthsOf(visits: readonly Visit[], firstCity: string | null, today: string, days: StandingDays) {
  const fittings = visits.filter((visit) => visit.fitting);
  const first = fittings[0];
  if (first === undefined) return [];
  const months: {
    month: string;
    state: string;
    visits: number;
    revenue: number;
    margin: number | null;
    city: string | null;
  }[] = [];
  for (let month = monthOf(first.day); month <= monthOf(today); month = addMonths(month, 1)) {
    const end = lastDayOf(month) < today ? lastDayOf(month) : today;
    const last = fittings.filter((visit) => visit.day <= end).at(-1) ?? first;
    const inMonth = visits.filter((visit) => monthOf(visit.day) === month);
    months.push({
      month,
      // The month of the first fitting is the client's first, as the dashboards count new clients.
      state: month === monthOf(first.day) ? "new" : standingOn(end, last.day, days),
      visits: inMonth.length,
      revenue: Math.round(inMonth.reduce((sum, visit) => sum + visit.earned, 0)) / 100,
      margin: marginOf(inMonth),
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
    readonly days: StandingRules;
    readonly today: string;
  },
): Promise<TableRows> {
  const { results } = await db.prepare(VISITS_DONE).all<VisitRow>();
  const byPerson = new Map<string, { visits: Visit[]; city: string | null; every: number }>();
  for (const row of results) {
    const held = byPerson.get(row.person_id) ?? { visits: [], city: null, every: row.every };
    const visit = {
      day: indiaDate(new Date(row.window_start)),
      fitting: row.fitting === 1,
      earned: row.earned,
      cost: row.cost,
    };
    if (visit.fitting && held.visits.every((each) => !each.fitting)) held.city = row.city;
    held.visits.push(visit);
    byPerson.set(row.person_id, held);
  }
  const rows: Row[] = [];
  for (const [personId, held] of byPerson) {
    const key = input.keys.get(personId);
    if (key === undefined) continue;
    const months = monthsOf(held.visits, held.city, input.today, { ...input.days, cadence: held.every });
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
        margin: month.margin,
      });
    }
  }
  return { table: "fact_client_month", key: ["month", "client_key"], stamped: true, rows };
}

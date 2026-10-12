// A row per lead in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): the day it came, its city,
// how it came (the site's form, the waitlist, the try-on or WhatsApp) and the page it landed on, and the days its client
// first booked a consultation, had one, paid for a first fit and was fitted. A first fit done counts as the
// consultation done too, since a fit can be booked as one visit with it. Records marked as tests are left out.

import { statusNotIn, VISIT_CALLED_OFF } from "../../config/statuses.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { TableRows } from "../../providers/warehouse/index.ts";

interface LeadRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly created_at: string;
  readonly city: string | null;
  readonly source: string | null;
  readonly landing_path: string | null;
  readonly consultation_booked: string | null;
  readonly consultation_done: string | null;
  readonly fit_paid: string | null;
  readonly fit_done: string | null;
}

const dayOf = (at: string | null) => (at === null ? null : indiaDate(new Date(at)));

const firstVisit = (types: string, done: boolean) =>
  `(SELECT MIN(${done ? "a.window_start" : "COALESCE(a.first_seen_at, a.synced_at)"}) FROM appointments a
    WHERE a.person_id = l.person_id AND a.type IN (${types}) AND a.deleted_at IS NULL
      ${done ? "AND a.status = 'completed'" : `AND ${statusNotIn("a.status", VISIT_CALLED_OFF)}`})`;

export async function leadRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.person_id, p.erased_at IS NOT NULL AS erased, l.created_at, l.city, l.source, l.landing_path,
         ${firstVisit("'consultation', 'first_fit'", false)} AS consultation_booked,
         ${firstVisit("'consultation', 'first_fit'", true)} AS consultation_done,
         (SELECT MIN(y.captured_at) FROM payments y JOIN appointments a ON a.id = y.appointment_id
           WHERE y.person_id = l.person_id AND a.type = 'first_fit' AND y.captured_at IS NOT NULL) AS fit_paid,
         ${firstVisit("'first_fit'", true)} AS fit_done
       FROM leads l JOIN people p ON p.id = l.person_id WHERE p.test_record = 0`,
    )
    .all<LeadRow>();
  return {
    table: "fact_lead",
    key: ["lead_key"],
    stamped: true,
    rows: results.map((row) => ({
      lead_key: row.id,
      lead_date: indiaDate(new Date(row.created_at)),
      client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
      city: row.city,
      area_key: null,
      // The channel rule comes with the growth figures; until then every lead is "direct".
      channel: "direct",
      campaign_key: null,
      landing_page: row.landing_path,
      source: row.source,
      consultation_booked_date: dayOf(row.consultation_booked),
      consultation_done_date: dayOf(row.consultation_done),
      first_fit_paid_date: dayOf(row.fit_paid),
      first_fit_done_date: dayOf(row.fit_done),
      lost_reason: null,
    })),
  };
}

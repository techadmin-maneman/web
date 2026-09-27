// Home's one contextual prompt (design/phase2/Client App, board B1: "One card,
// one prompt, nothing else"). The first of these that applies, and only one:
//
//   1. no address given, while something is booked: the technician cannot find
//      the door without one;
//   2. the piece in wear falling due, as a month and never a day (ADR 0059);
//   3. an invoice issued in the last fortnight, ready to open.
//
// One statement answers all three, so Home, the route the app calls every time
// it opens, costs one more D1 read and not three.

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import type { ClientState } from "./client-visits.ts";
import { DAY_MS } from "../lib/durations.ts";

/** How long a newly issued invoice is Home's prompt, before it is only on its visit's page. */
export const INVOICE_PROMPT_DAYS = 14;

export type HomePrompt =
  | { readonly kind: "address" }
  | { readonly kind: "replacement_due"; readonly month: string }
  | {
      readonly kind: "invoice_ready";
      readonly visit_id: string;
      /** India's date of the visit. */
      readonly date: string;
      readonly type: VisitType | null;
    };

const PROMPT = `SELECT
  EXISTS (SELECT 1 FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL) AS has_address,
  (SELECT MIN(replacement_due_at) FROM pieces
     WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL) AS due_on,
  invoiced.id AS invoiced_id, invoiced.type AS invoiced_type, invoiced.window_start AS invoiced_start
  FROM (SELECT 1) LEFT JOIN (
    SELECT id, type, window_start FROM appointments
    WHERE person_id = ?1 AND deleted_at IS NULL AND window_start IS NOT NULL AND invoice_issued_at >= ?2
    ORDER BY invoice_issued_at DESC LIMIT 1
  ) invoiced ON TRUE`;

interface Row {
  has_address: number;
  due_on: string | null;
  invoiced_id: string | null;
  invoiced_type: VisitType | null;
  invoiced_start: string | null;
}

/** The prompt Home shows this client, or null when nothing applies. */
export async function homePrompt(
  db: D1Database,
  personId: string,
  state: ClientState,
  now: Date,
): Promise<HomePrompt | null> {
  const since = new Date(now.getTime() - INVOICE_PROMPT_DAYS * DAY_MS).toISOString();
  const row = await db.prepare(PROMPT).bind(personId, since).first<Row>();
  if (row === null) return null;
  if (row.has_address === 0 && state !== "nothing_booked") return { kind: "address" };
  if (row.due_on !== null) return { kind: "replacement_due", month: row.due_on.slice(0, 7) };
  if (row.invoiced_id === null || row.invoiced_start === null) return null;
  return {
    kind: "invoice_ready",
    visit_id: row.invoiced_id,
    date: indiaDate(new Date(row.invoiced_start)),
    type: row.invoiced_type,
  };
}

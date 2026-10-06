// A discount code typed on /book for a consultation and fit in one visit while self-serve booking was off. It waits on
// the request for ops, and is honoured as it stood when typed: a code switched off or past its last day since still
// applies to the one visit booked from the request. Its uses are counted as they stand, since typing it kept none.

import { normalisedCode } from "../../policy/discount-codes.ts";

interface TypedCode {
  discount_code: string | null;
  created_at: string;
}

const typedAtIf = (row: TypedCode | null, text: string): Date | null =>
  row !== null && row.discount_code === normalisedCode(text) ? new Date(row.created_at) : null;

/** When the client typed `text` on their one-visit request still waiting for ops; null when it is not its code. */
export async function typedOnWaitingRequest(db: D1Database, personId: string, text: string): Promise<Date | null> {
  const row = await db
    .prepare(
      `SELECT discount_code, created_at FROM consultation_requests
       WHERE person_id = ?1 AND one_visit = 1 AND booked = 0
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<TypedCode>();
  return typedAtIf(row, text);
}

/**
 * The code the client typed on /book for the one visit `visit` names in the query: the last one-visit request they
 * made before it was booked, NULL for none.
 */
export const requestedCode = (visit: string): string =>
  `(SELECT r.discount_code FROM consultation_requests r
     WHERE ${visit}.one_visit IS NOT NULL AND r.person_id = ${visit}.person_id AND r.one_visit = 1
       AND r.created_at <= ${visit}.first_seen_at
     ORDER BY r.created_at DESC LIMIT 1)`;

/** When the client typed `text` on /book for this one visit; null when it is not the code they typed for it. */
export async function typedForVisit(db: D1Database, visitId: string, text: string): Promise<Date | null> {
  const row = await db
    .prepare(
      `SELECT r.discount_code, r.created_at FROM appointments a
       JOIN consultation_requests r ON r.person_id = a.person_id AND r.one_visit = 1 AND r.created_at <= a.first_seen_at
       WHERE a.id = ?1 AND a.one_visit IS NOT NULL
       ORDER BY r.created_at DESC LIMIT 1`,
    )
    .bind(visitId)
    .first<TypedCode>();
  return typedAtIf(row, text);
}

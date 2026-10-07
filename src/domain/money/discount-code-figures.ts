// What every discount code has come to together, for the head of Settings · Discount codes
// (docs/decisions/0108-discount-codes.md). It reads every use and every visit payment, which is fine for a page ops
// open now and then, and is why it stands apart from what the cron and the money path reach.

import { PAID_ON_USE, standing } from "./discount-codes.ts";

/** What every code has come to, standing uses only, whatever the list shows. */
interface CodeTotals {
  readonly codes: number;
  /** Not switched off, and not past its last day. */
  readonly live: number;
  readonly uses: number;
  readonly clients: number;
  readonly given: number;
  readonly paid: number;
}

/** Every code's figures together, standing uses only: the list's head, however many codes there are. */
export async function codeTotals(db: D1Database, now: Date, today: string): Promise<CodeTotals> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM discount_codes) AS codes,
         (SELECT COUNT(*) FROM discount_codes
           WHERE switched_off_at IS NULL AND (expires_on IS NULL OR expires_on >= ?2)) AS live,
         (SELECT COUNT(*) FROM discount_code_uses u WHERE ${standing("u", "?1")}) AS uses,
         (SELECT COUNT(DISTINCT u.person_id) FROM discount_code_uses u WHERE ${standing("u", "?1")}) AS clients,
         (SELECT COALESCE(SUM(u.amount_off), 0) FROM discount_code_uses u WHERE ${standing("u", "?1")}) AS given,
         (${PAID_ON_USE} WHERE ${standing("u", "?1")}) AS paid`,
    )
    .bind(now.toISOString(), today)
    .first<CodeTotals>();
  return row ?? { codes: 0, live: 0, uses: 0, clients: 0, given: 0, paid: 0 };
}

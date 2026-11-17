// Razorpay's settlements to the bank (docs/decisions/0261-razorpay-money-in-books.md): what Razorpay held for us, less
// its fee, paid out to the bank. Each processed one is kept as Razorpay's webhook tells of it, or as the hourly
// catch-up finds it among the last week's, so the Books pass can record its transfer and its fee (migration 0216).

import type { PaymentsProvider } from "../../providers/payments/index.ts";
import type { RazorpaySettlement } from "../../providers/payments/razorpay.ts";
import { DAY_MS } from "../../lib/durations.ts";

/** How far back the catch-up reads Razorpay's settlements: a week, past any webhook's retries. */
export const SETTLEMENTS_READ_DAYS = 7;

/** Keeps a settlement Razorpay has made, once; one not yet processed is not money in the bank, and waits. */
export async function keepSettlement(db: D1Database, settlement: RazorpaySettlement, now: Date): Promise<boolean> {
  if (settlement.status !== "processed") return false;
  const kept = await db
    .prepare(
      `INSERT OR IGNORE INTO razorpay_settlements (id, amount, fees, tax, utr, settled_at, received_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      settlement.id,
      settlement.amount,
      settlement.fees,
      settlement.tax,
      settlement.utr ?? null,
      new Date(settlement.created_at * 1000).toISOString(),
      now.toISOString(),
    )
    .run();
  return kept.meta.changes > 0;
}

/** Keeps the last week's settlements the webhook may have missed: how many were new. */
export async function catchUpSettlements(db: D1Database, payments: PaymentsProvider, now: Date): Promise<number> {
  const to = Math.floor(now.getTime() / 1000);
  const from = Math.floor((now.getTime() - SETTLEMENTS_READ_DAYS * DAY_MS) / 1000);
  let found = 0;
  for (const settlement of await payments.settlements(from, to)) {
    if (await keepSettlement(db, settlement, now)) found += 1;
  }
  return found;
}

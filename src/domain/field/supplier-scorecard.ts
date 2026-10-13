// Each supplier's scorecard (docs/decisions/0172-supplier-scorecard.md): a year of its orders, what arrived of them, and
// its claims, read in three statements and scored by src/policy/supplier-scorecard.ts.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import {
  scorecardOf,
  type ArrivedUnits,
  type ClaimCounts,
  type Scorecard,
  type ScoredOrder,
} from "../../policy/supplier-scorecard.ts";

export interface SupplierScore extends Scorecard {
  readonly supplierId: string;
  readonly name: string;
  readonly currency: string;
}

type OrderRow = {
  supplier_id: string;
  state: string;
  sent_at: string;
  expected_on: string | null;
  first_received: string | null;
  last_received: string | null;
  promised_days: number | null;
};
type ArrivedRow = { supplier_id: string; received: number; damaged: number; failed: number };
type ClaimRow = { supplier_id: string; settled: number; accepted: number; credited: number };
type SupplierRow = { id: string; name: string; currency: string };

const dayOf = (instant: string | null) => (instant === null ? null : indiaDate(new Date(instant)));

function scoredOrder(row: OrderRow): ScoredOrder {
  const sentOn = indiaDate(new Date(row.sent_at));
  const promisedDue = row.promised_days === null ? null : addDays(sentOn, row.promised_days);
  return {
    state: row.state,
    sentOn,
    dueOn: row.expected_on ?? promisedDue,
    firstReceivedOn: dayOf(row.first_received),
    lastReceivedOn: dayOf(row.last_received),
    promisedDays: row.promised_days,
  };
}

/** Every supplier not retired, and any retired one with orders this year, each with its scorecard. */
export async function supplierScores(db: D1Database, now: Date, days: number): Promise<SupplierScore[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  const [suppliers, orders, arrived, claims] = await db.batch<SupplierRow | OrderRow | ArrivedRow | ClaimRow>([
    db.prepare("SELECT id, name, currency FROM suppliers WHERE retired_at IS NULL OR retired_at >= ?1").bind(since),
    db
      .prepare(
        `SELECT o.supplier_id, o.state, o.sent_at, o.expected_on,
           (SELECT MIN(received_at) FROM receipts WHERE po_id = o.id) AS first_received,
           (SELECT MAX(received_at) FROM receipts WHERE po_id = o.id) AS last_received,
           (SELECT MAX(i.lead_time_days) FROM po_lines p JOIN supplier_items i
              ON i.supplier_id = o.supplier_id AND i.consumable_code = p.consumable_code
            WHERE p.po_id = o.id) AS promised_days
         FROM purchase_orders o WHERE o.sent_at >= ?1`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT o.supplier_id, SUM(l.received) AS received, SUM(l.damaged) AS damaged, SUM(l.qc_failed) AS failed
         FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id JOIN purchase_orders o ON o.id = r.po_id
         WHERE r.received_at >= ?1 GROUP BY o.supplier_id`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT supplier_id, SUM(state IN ('accepted', 'rejected')) AS settled, SUM(state = 'accepted') AS accepted,
           COALESCE(SUM(credit_amount), 0) AS credited
         FROM supplier_claims WHERE drafted_at >= ?1 GROUP BY supplier_id`,
      )
      .bind(since),
  ]);
  const orderRows = (orders?.results ?? []) as OrderRow[];
  const arrivedOf = new Map(((arrived?.results ?? []) as ArrivedRow[]).map((row) => [row.supplier_id, row]));
  const claimsOf = new Map(((claims?.results ?? []) as ClaimRow[]).map((row) => [row.supplier_id, row]));
  const none: ArrivedUnits = { received: 0, damaged: 0, failed: 0 };
  const noClaims: ClaimCounts = { settled: 0, accepted: 0, credited: 0 };
  return ((suppliers?.results ?? []) as SupplierRow[]).map((supplier) => {
    const claimRow = claimsOf.get(supplier.id);
    return {
      supplierId: supplier.id,
      name: supplier.name,
      currency: supplier.currency,
      ...scorecardOf(
        orderRows.filter((row) => row.supplier_id === supplier.id).map(scoredOrder),
        arrivedOf.get(supplier.id) ?? none,
        claimRow === undefined
          ? noClaims
          : { settled: claimRow.settled, accepted: claimRow.accepted, credited: claimRow.credited },
      ),
    };
  });
}

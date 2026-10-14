// Claims on suppliers (docs/decisions/0169-supplier-claims.md): what arrived damaged or failed its check, drafted with
// its receipt, and a returned piece inside its supplier's warranty (./returned-pieces.ts). Ops send each to the
// supplier, then record what came of it: a credit, a replacement, or a refusal. A claim not worth sending is withdrawn.

import { drawnNumbers, freshNumber } from "../../lib/references.ts";
import { auditStatementWhen, type AuditAction } from "../platform/audit.ts";
import type { Written } from "../inventory/stock.ts";

export const CLAIM_REASONS = ["damaged", "qc_failed", "warranty"] as const;
export const CLAIM_STATES = ["drafted", "sent", "accepted", "rejected", "withdrawn"] as const;
export const CLAIM_OUTCOMES = ["credit", "replacement"] as const;

export interface SupplierClaim {
  readonly id: string;
  readonly number: number;
  readonly supplierId: string;
  readonly consumableCode: string;
  readonly name: string;
  readonly quantity: number;
  readonly reason: (typeof CLAIM_REASONS)[number];
  readonly orderNumber: number;
  readonly pieceCode: string | null;
  readonly unitPrice: number;
  readonly currency: string;
  readonly state: (typeof CLAIM_STATES)[number];
  readonly outcome: (typeof CLAIM_OUTCOMES)[number] | null;
  readonly creditAmount: number | null;
  readonly note: string | null;
  readonly draftedAt: string;
  readonly sentAt: string | null;
  readonly decidedAt: string | null;
  /** The photograph sent with it, if any (./stock-photos.ts). */
  readonly photoId: string | null;
}

/** How many settled claims the list shows after every open one. */
const SETTLED_SHOWN = 50;

/**
 * A receipt line's claims: one for what arrived damaged, one for what failed its check, each at the order line's
 * price. Written in the receipt's batch, so each takes a number the one before did not.
 */
export function receiptClaimStatements(
  db: D1Database,
  line: { readonly id: string; readonly poLineId: string; readonly damaged: number; readonly qcFailed: number },
  written: Written,
): D1PreparedStatement[] {
  const claims = [
    { reason: "damaged", quantity: line.damaged },
    { reason: "qc_failed", quantity: line.qcFailed },
  ].filter((claim) => claim.quantity > 0);
  return claims.map((claim) =>
    db
      .prepare(
        `INSERT INTO supplier_claims (id, number, supplier_id, consumable_code, quantity, reason, receipt_line_id,
           unit_price, currency, state, drafted_by, drafted_at)
         SELECT ?1, ${freshNumber("supplier_claims", "?8")}, o.supplier_id, p.consumable_code, ?2, ?3, ?4, p.unit_price,
           o.currency, 'drafted', ?5, ?6
         FROM po_lines p JOIN purchase_orders o ON o.id = p.po_id WHERE p.id = ?7`,
      )
      .bind(
        crypto.randomUUID(),
        claim.quantity,
        claim.reason,
        line.id,
        written.actor.id,
        written.now.toISOString(),
        line.poLineId,
        drawnNumbers(),
      ),
  );
}

type ClaimRow = {
  id: string;
  number: number;
  supplier_id: string;
  consumable_code: string;
  name: string;
  quantity: number;
  reason: SupplierClaim["reason"];
  order_number: number;
  piece_code: string | null;
  unit_price: number;
  currency: string;
  state: SupplierClaim["state"];
  outcome: SupplierClaim["outcome"];
  credit_amount: number | null;
  note: string | null;
  drafted_at: string;
  sent_at: string | null;
  decided_at: string | null;
  photo_id: string | null;
};

/** Every open claim, newest first, then the latest settled. */
export async function supplierClaims(db: D1Database): Promise<SupplierClaim[]> {
  const columns = `k.id, k.number, k.supplier_id, k.consumable_code, c.name, k.quantity, k.reason, o.number AS order_number,
    u.code AS piece_code, k.unit_price, k.currency, k.state, k.outcome, k.credit_amount, k.note, k.drafted_at, k.sent_at,
    k.decided_at, k.photo_id`;
  const joins = `JOIN consumables c ON c.code = k.consumable_code JOIN receipt_lines l ON l.id = k.receipt_line_id
    JOIN receipts r ON r.id = l.receipt_id JOIN purchase_orders o ON o.id = r.po_id
    LEFT JOIN stock_units u ON u.id = k.unit_id`;
  const [open, settled] = await db.batch<ClaimRow>([
    db.prepare(
      `SELECT ${columns} FROM supplier_claims k INDEXED BY supplier_claims_open ${joins}
       WHERE k.state IN ('drafted', 'sent') ORDER BY k.drafted_at DESC, k.rowid DESC`,
    ),
    db
      .prepare(
        `SELECT ${columns} FROM supplier_claims k ${joins}
         WHERE k.state NOT IN ('drafted', 'sent') ORDER BY k.drafted_at DESC, k.rowid DESC LIMIT ?1`,
      )
      .bind(SETTLED_SHOWN),
  ]);
  return [...(open?.results ?? []), ...(settled?.results ?? [])].map((row) => ({
    id: row.id,
    number: row.number,
    supplierId: row.supplier_id,
    consumableCode: row.consumable_code,
    name: row.name,
    quantity: row.quantity,
    reason: row.reason,
    orderNumber: row.order_number,
    pieceCode: row.piece_code,
    unitPrice: row.unit_price,
    currency: row.currency,
    state: row.state,
    outcome: row.outcome,
    creditAmount: row.credit_amount,
    note: row.note,
    draftedAt: row.drafted_at,
    sentAt: row.sent_at,
    decidedAt: row.decided_at,
    photoId: row.photo_id,
  }));
}

export type ClaimChanged =
  { readonly ok: true } | { readonly ok: false; readonly missing: true } | { readonly ok: false; readonly state: true };

/**
 * A claim's update and its audit entry, the entry written only where the update stamped this request's token, so a
 * step refused for the claim's state is never audited. Its SQL sets `change_id = ?1`, the token, on the claim `?2`,
 * and takes its own values from `?3` on.
 */
async function changed(
  db: D1Database,
  claim: { readonly id: string; readonly action: AuditAction },
  update: { readonly sql: string; readonly values: readonly (string | number | null)[] },
  written: Written,
): Promise<ClaimChanged> {
  const token = crypto.randomUUID();
  const entry = {
    surface: "ops" as const,
    actor: written.actor,
    action: claim.action,
    subject: { kind: "supplier_claim", id: claim.id },
    requestId: written.requestId,
  };
  const landed = {
    sql: "EXISTS (SELECT 1 FROM supplier_claims WHERE id = ?10 AND change_id = ?11)",
    binds: [claim.id, token],
  };
  const [result] = await db.batch([
    db.prepare(update.sql).bind(token, claim.id, ...update.values),
    auditStatementWhen(db, entry, written.now, landed),
  ]);
  if (result?.meta.changes === 1) return { ok: true };
  const exists = await db.prepare("SELECT 1 FROM supplier_claims WHERE id = ?1").bind(claim.id).first();
  return exists === null ? { ok: false, missing: true } : { ok: false, state: true };
}

/** A drafted claim marked sent to its supplier, with what was said and the photograph shown, if any. */
export function sendClaim(
  db: D1Database,
  id: string,
  sent: { readonly note: string | null; readonly photoId: string | null },
  written: Written,
): Promise<ClaimChanged> {
  const update = {
    sql: `UPDATE supplier_claims SET change_id = ?1, state = 'sent', sent_by = ?3, sent_at = ?4, note = COALESCE(?5, note),
            photo_id = COALESCE(?6, photo_id)
          WHERE id = ?2 AND state = 'drafted'`,
    values: [written.actor.id, written.now.toISOString(), sent.note, sent.photoId],
  };
  return changed(db, { id, action: "supplier_claim.send" }, update, written);
}

/** A drafted claim withdrawn, with why: not worth sending. */
export function withdrawClaim(db: D1Database, id: string, note: string, written: Written): Promise<ClaimChanged> {
  const update = {
    sql: `UPDATE supplier_claims SET change_id = ?1, state = 'withdrawn', decided_by = ?3, decided_at = ?4, note = ?5
          WHERE id = ?2 AND state = 'drafted'`,
    values: [written.actor.id, written.now.toISOString(), note],
  };
  return changed(db, { id, action: "supplier_claim.withdraw" }, update, written);
}

/** What the supplier answered a claim sent: a credit of this much, a replacement, or a refusal. */
export type ClaimAnswer =
  | { readonly outcome: "credit"; readonly creditAmount: number }
  | { readonly outcome: "replacement" }
  | { readonly outcome: "rejected" };

/** A sent claim settled by the supplier's answer, with a note if there is one. */
export function decideClaim(
  db: D1Database,
  id: string,
  answer: ClaimAnswer & { readonly note: string | null },
  written: Written,
): Promise<ClaimChanged> {
  const accepted = answer.outcome !== "rejected";
  const update = {
    sql: `UPDATE supplier_claims SET change_id = ?1, state = ?5, outcome = ?6, credit_amount = ?7,
            note = COALESCE(?8, note), decided_by = ?3, decided_at = ?4
          WHERE id = ?2 AND state = 'sent'`,
    values: [
      written.actor.id,
      written.now.toISOString(),
      accepted ? "accepted" : "rejected",
      accepted ? answer.outcome : null,
      answer.outcome === "credit" ? answer.creditAmount : null,
      answer.note,
    ],
  };
  return changed(db, { id, action: "supplier_claim.decide" }, update, written);
}

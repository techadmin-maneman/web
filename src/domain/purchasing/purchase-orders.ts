// Purchase orders (docs/decisions/0166-purchase-orders.md): drafted from a supplier's list, each line at the price the
// supplier lists it at; approved by an Operations manager, and by a second one above the amount ops set or in another
// currency (src/policy/purchasing.ts); marked sent once ops have sent it; or cancelled before anything arrives.
// Receipts move it on from sent (src/domain/purchasing/receipts.ts), and one part received may be closed short.
//
// Each change is a conditional write with its audit entry, so two managers approving at once approve once.

import { needsSecondApproval, CANCELLABLE, type PoState } from "../../policy/purchasing.ts";
import { auditStatement, auditStatementWhen, type AuditActor, type AuditAction } from "../platform/audit.ts";

interface PoLine {
  readonly id: string;
  readonly code: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly received: number;
}

export interface PurchaseOrder {
  readonly id: string;
  readonly number: number;
  readonly supplierId: string;
  readonly currency: string;
  readonly state: PoState;
  readonly expectedOn: string | null;
  readonly note: string | null;
  readonly total: number;
  readonly lines: readonly PoLine[];
  readonly draftedBy: string;
  readonly draftedAt: string;
  readonly approvedBy: string | null;
  readonly secondApprovedBy: string | null;
  readonly sentAt: string | null;
  readonly cancelReason: string | null;
}

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type OrderRow = {
  id: string;
  number: number;
  supplier_id: string;
  currency: string;
  state: PoState;
  expected_on: string | null;
  note: string | null;
  drafted_by: string;
  drafted_at: string;
  approved_by: string | null;
  second_approved_by: string | null;
  sent_at: string | null;
  cancel_reason: string | null;
};

type LineRow = {
  id: string;
  po_id: string;
  consumable_code: string;
  quantity: number;
  unit_price: number;
  received_quantity: number;
};

/** How many closed and cancelled orders the page keeps beneath the open ones. */
const SETTLED_SHOWN = 100;

/** Every open order, and the latest settled ones, newest first. */
export async function purchaseOrders(db: D1Database): Promise<PurchaseOrder[]> {
  const { results } = await db
    .prepare(
      `SELECT id, number, supplier_id, currency, state, expected_on, note, drafted_by, drafted_at, approved_by,
         second_approved_by, sent_at, cancel_reason
       FROM purchase_orders ORDER BY state IN ('received', 'closed', 'cancelled'), number DESC LIMIT ?1`,
    )
    .bind(SETTLED_SHOWN)
    .all<OrderRow>();
  const lines = await db
    .prepare(
      `SELECT id, po_id, consumable_code, quantity, unit_price, received_quantity FROM po_lines
       WHERE po_id IN (SELECT value FROM json_each(?1)) ORDER BY rowid`,
    )
    .bind(JSON.stringify(results.map((row) => row.id)))
    .all<LineRow>();
  return results.map((row) => {
    const own = lines.results
      .filter((line) => line.po_id === row.id)
      .map((line) => ({
        id: line.id,
        code: line.consumable_code,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        received: line.received_quantity,
      }));
    return {
      id: row.id,
      number: row.number,
      supplierId: row.supplier_id,
      currency: row.currency,
      state: row.state,
      expectedOn: row.expected_on,
      note: row.note,
      total: own.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
      lines: own,
      draftedBy: row.drafted_by,
      draftedAt: row.drafted_at,
      approvedBy: row.approved_by,
      secondApprovedBy: row.second_approved_by,
      sentAt: row.sent_at,
      cancelReason: row.cancel_reason,
    };
  });
}

const entry = (written: Written, action: AuditAction, id: string, detail: Record<string, string | number> = {}) => ({
  surface: "ops" as const,
  actor: written.actor,
  action,
  subject: { kind: "purchase_order", id },
  requestId: written.requestId,
  detail,
});

type Refused = { readonly ok: false; readonly fields: string[] };

/**
 * A new order to an active supplier, each line of a stock code it lists, at its listed price, of at least its minimum
 * order. Refused, naming the field, otherwise.
 */
export async function draftOrder(
  db: D1Database,
  draft: {
    readonly supplierId: string;
    readonly lines: readonly { readonly code: string; readonly quantity: number }[];
    readonly expectedOn: string | null;
    readonly note: string | null;
  },
  written: Written,
): Promise<{ readonly ok: true; readonly id: string } | Refused> {
  const supplier = await db
    .prepare("SELECT currency FROM suppliers WHERE id = ?1 AND retired_at IS NULL")
    .bind(draft.supplierId)
    .first<{ currency: string }>();
  if (supplier === null) return { ok: false, fields: ["supplier_id"] };
  const { results: listed } = await db
    .prepare("SELECT consumable_code, unit_price, minimum_order FROM supplier_items WHERE supplier_id = ?1")
    .bind(draft.supplierId)
    .all<{ consumable_code: string; unit_price: number; minimum_order: number }>();
  const priced = draft.lines.map((line) => ({ line, item: listed.find((each) => each.consumable_code === line.code) }));
  const refused = priced.findIndex(({ line, item }) => item === undefined || line.quantity < item.minimum_order);
  if (refused >= 0) return { ok: false, fields: [`lines.${String(refused)}`] };
  if (new Set(draft.lines.map((line) => line.code)).size !== draft.lines.length)
    return { ok: false, fields: ["lines"] };

  const id = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    auditStatement(db, entry(written, "purchase_order.draft", id, { lines: draft.lines.length }), written.now),
    db
      .prepare(
        `INSERT INTO purchase_orders (id, number, supplier_id, currency, state, expected_on, note, drafted_by, drafted_at,
           updated_at)
         SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, 'drafted', ?4, ?5, ?6, ?7, ?7 FROM purchase_orders`,
      )
      .bind(id, draft.supplierId, supplier.currency, draft.expectedOn, draft.note, written.actor.id, at),
    ...priced.map(({ line, item }) =>
      db
        .prepare("INSERT INTO po_lines (id, po_id, consumable_code, quantity, unit_price) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(crypto.randomUUID(), id, line.code, line.quantity, item?.unit_price ?? 0),
    ),
  ]);
  return { ok: true, id };
}

/** An order's change, written only where its state still allows it: refused as gone, or as no longer allowed. */
type Changed =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: true }
  | { readonly ok: false; readonly state: true }
  | { readonly ok: false; readonly sameApprover: true }
  | { readonly ok: false; readonly customOrder: true };

/** An update of one order, `?1` its ID, stamping `change_id = ?9`, which this request's token fills. */
interface OrderUpdate {
  readonly sql: string;
  readonly binds: readonly (string | number | null)[];
}

/**
 * The update and its audit entry, the entry written only where the update stamped this request's token, so a change
 * refused for its state is never audited, however close in time to another.
 */
async function changed(
  db: D1Database,
  order: { readonly id: string; readonly action: AuditAction },
  update: OrderUpdate,
  written: Written,
): Promise<Changed> {
  const token = crypto.randomUUID();
  const unused = Array.from({ length: 8 - update.binds.length }, () => null);
  const landed = {
    sql: "EXISTS (SELECT 1 FROM purchase_orders WHERE id = ?10 AND change_id = ?11)",
    binds: [order.id, token],
  };
  const [result] = await db.batch([
    db.prepare(update.sql).bind(...update.binds, ...unused, token),
    auditStatementWhen(db, entry(written, order.action, order.id), written.now, landed),
  ]);
  if (result?.meta.changes === 1) return { ok: true };
  const exists = await db.prepare("SELECT 1 FROM purchase_orders WHERE id = ?1").bind(order.id).first();
  return exists === null ? { ok: false, missing: true } : { ok: false, state: true };
}

/**
 * An approval: the first, or a second by another manager where the order needs one. An order needing none, or given
 * its second, is approved.
 */
export async function approveOrder(
  db: D1Database,
  id: string,
  rule: { readonly aboveRupees: number; readonly rupeesToOne: Readonly<Record<string, number>> },
  written: Written,
): Promise<Changed> {
  const order = (await purchaseOrders(db)).find((each) => each.id === id) ?? null;
  if (order === null) return { ok: false, missing: true };
  if (order.state !== "drafted") return { ok: false, state: true };
  if (order.approvedBy === written.actor.id) return { ok: false, sameApprover: true };
  const at = written.now.toISOString();
  const twice = needsSecondApproval(order, rule.aboveRupees, rule.rupeesToOne);
  const update: OrderUpdate =
    order.approvedBy === null
      ? {
          sql: `UPDATE purchase_orders SET change_id = ?9, approved_by = ?2, approved_at = ?3, state = ?4, updated_at = ?3
                WHERE id = ?1 AND state = 'drafted' AND approved_by IS NULL`,
          binds: [id, written.actor.id, at, twice ? "drafted" : "approved"],
        }
      : {
          sql: `UPDATE purchase_orders SET change_id = ?9, second_approved_by = ?2, second_approved_at = ?3,
                  state = 'approved', updated_at = ?3
                WHERE id = ?1 AND state = 'drafted' AND approved_by IS NOT NULL AND approved_by <> ?2
                  AND second_approved_by IS NULL`,
          binds: [id, written.actor.id, at],
        };
  return changed(db, { id, action: "purchase_order.approve" }, update, written);
}

/** An approved order marked sent, once ops have sent it to the supplier. */
export function markSent(db: D1Database, id: string, written: Written): Promise<Changed> {
  const update = {
    sql: `UPDATE purchase_orders SET change_id = ?9, state = 'sent', sent_by = ?2, sent_at = ?3, updated_at = ?3
          WHERE id = ?1 AND state = 'approved'`,
    binds: [id, written.actor.id, written.now.toISOString()],
  };
  return changed(db, { id, action: "purchase_order.send" }, update, written);
}

/** An order part received closed short: what has not arrived will not, and no more is received against it. */
export function closeOrder(db: D1Database, id: string, written: Written): Promise<Changed> {
  const update = {
    sql: `UPDATE purchase_orders SET change_id = ?9, state = 'closed', updated_at = ?2
          WHERE id = ?1 AND state = 'part_received'`,
    binds: [id, written.now.toISOString()],
  };
  return changed(db, { id, action: "purchase_order.close" }, update, written);
}

/**
 * An order cancelled, with why, before anything of it arrived. One carrying a client's custom order is cancelled
 * through the custom order, which refunds them; cancelled here, the client's money would have nowhere to go.
 */
export async function cancelOrder(db: D1Database, id: string, reason: string, written: Written): Promise<Changed> {
  const carries = await db
    .prepare("SELECT 1 FROM po_lines WHERE po_id = ?1 AND custom_order_id IS NOT NULL LIMIT 1")
    .bind(id)
    .first();
  if (carries !== null) return { ok: false, customOrder: true };
  const update = {
    sql: `UPDATE purchase_orders SET change_id = ?9, state = 'cancelled', cancelled_by = ?2, cancelled_at = ?3,
            cancel_reason = ?4, updated_at = ?3
          WHERE id = ?1 AND state IN (SELECT value FROM json_each(?5))`,
    binds: [id, written.actor.id, written.now.toISOString(), reason, JSON.stringify([...CANCELLABLE])],
  };
  return changed(db, { id, action: "purchase_order.cancel" }, update, written);
}

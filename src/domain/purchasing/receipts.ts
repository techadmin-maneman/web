// Receipts against purchase orders (docs/decisions/0167-receipts-and-landed-cost.md): what arrived at the warehouse of
// each line, accepted into stock as a delivery is, in its lot and, of a hair system, each piece labelled
// (src/domain/inventory/stock.ts); what was damaged or failed its check, which never enters stock and is claimed on the
// supplier (./supplier-claims.ts); and what one cost landed
// (src/policy/purchasing.ts), kept on the line and on its lot. The order moves on to part received or received.

import { landedUnitCosts } from "../../policy/purchasing.ts";
import { auditStatement, type AuditActor } from "../platform/audit.ts";
import { deliveryStatements } from "../inventory/stock.ts";
import { receiptClaimStatements } from "./supplier-claims.ts";

export interface ReceiptLine {
  readonly poLineId: string;
  readonly received: number;
  readonly damaged: number;
  readonly qcFailed: number;
  readonly lotCode: string | null;
  readonly expiresOn: string | null;
}

export interface Receipt {
  readonly id: string;
  readonly poId: string;
  readonly receivedBy: string;
  readonly receivedAt: string;
  readonly supplierInvoice: string | null;
  readonly lines: readonly (ReceiptLine & { readonly landedUnitPaise: number })[];
}

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type Refused = { readonly ok: false; readonly fields: string[] } | { readonly ok: false; readonly state: true };

type OrderLineRow = {
  id: string;
  consumable_code: string;
  unit_price: number;
  /** What is still owed of the line: ordered, less what has come in. */
  outstanding: number;
  number: number;
  currency: string;
  state: string;
};

/** Whether the order's supplier has had this invoice received already, on any of its orders. */
async function invoiceReceived(db: D1Database, poId: string, invoice: string): Promise<boolean> {
  const found = await db
    .prepare(
      `SELECT 1 FROM receipts r JOIN purchase_orders o ON o.id = r.po_id
       WHERE o.supplier_id = (SELECT supplier_id FROM purchase_orders WHERE id = ?1)
         AND lower(trim(r.supplier_invoice)) = lower(trim(?2)) LIMIT 1`,
    )
    .bind(poId, invoice)
    .first();
  return found !== null;
}

/** What the database refused a receipt for (migrations/0159), as the field it names. */
function refusedField(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("over_received") ? "lines" : null;
}

/** What a receipt is checked against: its order's lines, each with the order's number, currency and state. */
async function checkedReceipt(
  db: D1Database,
  receipt: {
    readonly poId: string;
    readonly lines: readonly ReceiptLine[];
    readonly rupeeRate: number | null;
    readonly supplierInvoice: string | null;
  },
): Promise<
  | {
      readonly ok: true;
      readonly order: OrderLineRow;
      readonly rate: number;
      readonly matched: readonly { readonly line: ReceiptLine; readonly of: OrderLineRow | undefined }[];
    }
  | Refused
> {
  const { results: orderLines } = await db
    .prepare(
      `SELECT l.id, l.consumable_code, l.unit_price, l.quantity - l.received_quantity AS outstanding, o.number,
         o.currency, o.state FROM po_lines l
       JOIN purchase_orders o ON o.id = l.po_id WHERE l.po_id = ?1`,
    )
    .bind(receipt.poId)
    .all<OrderLineRow>();
  const order = orderLines[0];
  if (order === undefined) return { ok: false, fields: ["id"] };
  if (order.state !== "sent" && order.state !== "part_received") return { ok: false, state: true };
  const rate = order.currency === "INR" ? 100 : receipt.rupeeRate;
  if (rate === null || rate <= 0) return { ok: false, fields: ["rupee_rate"] };
  const matched = receipt.lines.map((line) => ({ line, of: orderLines.find((each) => each.id === line.poLineId) }));
  const stray = matched.findIndex(({ of }) => of === undefined);
  if (stray >= 0) return { ok: false, fields: [`lines.${String(stray)}`] };
  if (receipt.lines.every((line) => line.received + line.damaged + line.qcFailed === 0)) {
    return { ok: false, fields: ["lines"] };
  }
  // No line takes more than it still owes, however it arrived.
  const over = matched.findIndex(
    ({ line, of }) => line.received + line.damaged + line.qcFailed > (of?.outstanding ?? 0),
  );
  if (over >= 0) return { ok: false, fields: [`lines.${String(over)}`] };
  if (receipt.supplierInvoice !== null && (await invoiceReceived(db, receipt.poId, receipt.supplierInvoice))) {
    return { ok: false, fields: ["supplier_invoice"] };
  }
  return { ok: true, order, rate, matched };
}

/**
 * A receipt against an order sent or part received. Refused, naming the field, for a line not of the order, nothing
 * received at all, or an order in another currency with no rupee rate; or for an order past receiving.
 */
export async function receiveOrder(
  db: D1Database,
  receipt: {
    readonly poId: string;
    readonly lines: readonly ReceiptLine[];
    readonly supplierInvoice: string | null;
    readonly rupeeRate: number | null;
    readonly extras: { readonly freight: number; readonly duty: number; readonly clearing: number };
    readonly note: string | null;
  },
  written: Written,
): Promise<{ readonly ok: true; readonly id: string } | Refused> {
  const checked = await checkedReceipt(db, receipt);
  if (!checked.ok) return checked;
  const { order, rate, matched } = checked;

  const { freight, duty, clearing } = receipt.extras;
  const landed = landedUnitCosts(
    matched.map(({ line, of }) => ({ unitPrice: of?.unit_price ?? 0, received: line.received })),
    rate,
    freight + duty + clearing,
  );
  const id = crypto.randomUUID();
  const lines: D1PreparedStatement[] = [];
  for (const [index, { line, of }] of matched.entries()) {
    const movementId = line.received > 0 ? crypto.randomUUID() : null;
    if (movementId !== null && of !== undefined) {
      const lot = { lotCode: line.lotCode, expiresOn: line.expiresOn };
      const note = `PO-${String(order.number).padStart(4, "0")}`;
      const delivered = await deliveryStatements(
        db,
        { code: of.consumable_code, quantity: line.received, note, lot },
        written,
        movementId,
      );
      if (!delivered.ok) return { ok: false, fields: [`lines.${String(index)}`] };
      lines.push(...delivered.statements);
    }
    lines.push(
      ...lineStatements(db, { receiptId: id, line, landedUnitPaise: landed[index] ?? 0, movementId }, written),
    );
  }
  const batch = [
    receivedAudit(db, { poId: receipt.poId, id, lines: receipt.lines.length }, written),
    db
      .prepare(
        `INSERT INTO receipts (id, po_id, received_by, received_at, supplier_invoice, rupee_rate, freight_paise, duty_paise,
           clearing_paise, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        id,
        receipt.poId,
        written.actor.id,
        written.now.toISOString(),
        receipt.supplierInvoice,
        rate,
        freight,
        duty,
        clearing,
        receipt.note,
      ),
    ...lines,
    // What arrived settles the order: received once every line has all it ordered, part received until then.
    db
      .prepare(
        `UPDATE purchase_orders SET change_id = ?3, updated_at = ?2,
           state = CASE WHEN EXISTS (SELECT 1 FROM po_lines WHERE po_id = ?1 AND received_quantity < quantity)
             THEN 'part_received' ELSE 'received' END
         WHERE id = ?1 AND state IN ('sent', 'part_received')`,
      )
      .bind(receipt.poId, written.now.toISOString(), crypto.randomUUID()),
  ];
  try {
    await db.batch(batch);
  } catch (error) {
    // A second receipt that landed beside this one took what was owed first.
    const field = refusedField(error);
    if (field === null) throw error;
    return { ok: false, fields: [field] };
  }
  return { ok: true, id };
}

/** The receipt's audit entry, under its order. */
function receivedAudit(
  db: D1Database,
  receipt: { readonly poId: string; readonly id: string; readonly lines: number },
  written: Written,
): D1PreparedStatement {
  return auditStatement(
    db,
    {
      surface: "ops",
      actor: written.actor,
      action: "purchase_order.receive",
      subject: { kind: "purchase_order", id: receipt.poId },
      requestId: written.requestId,
      detail: { receipt: receipt.id, lines: receipt.lines },
    },
    written.now,
  );
}

/**
 * A receipt's line, what it adds to the order's line, its landed cost on the lot it went into, and its claims on the
 * supplier for what arrived damaged or failed its check.
 */
function lineStatements(
  db: D1Database,
  row: {
    readonly receiptId: string;
    readonly line: ReceiptLine;
    readonly landedUnitPaise: number;
    readonly movementId: string | null;
  },
  written: Written,
): D1PreparedStatement[] {
  const { line } = row;
  const lineId = crypto.randomUUID();
  return [
    db
      .prepare(
        `INSERT INTO receipt_lines (id, receipt_id, po_line_id, received, damaged, qc_failed, lot_code, expires_on,
           landed_unit_paise, movement_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        lineId,
        row.receiptId,
        line.poLineId,
        line.received,
        line.damaged,
        line.qcFailed,
        line.lotCode,
        line.expiresOn,
        row.landedUnitPaise,
        row.movementId,
      ),
    db
      .prepare("UPDATE po_lines SET received_quantity = received_quantity + ?2 WHERE id = ?1")
      .bind(line.poLineId, line.received),
    ...(row.movementId === null
      ? []
      : [
          db
            .prepare(
              "UPDATE stock_lots SET landed_cost_paise = ?2 WHERE id IN (SELECT lot_id FROM stock_lot_moves WHERE movement_id = ?1)",
            )
            .bind(row.movementId, row.landedUnitPaise),
          // A custom order's piece is reserved to it as it is labelled (./custom-orders.ts).
          db
            .prepare(
              `UPDATE stock_units SET custom_order_id = (SELECT custom_order_id FROM po_lines WHERE id = ?2)
               WHERE id IN (SELECT unit_id FROM stock_unit_events WHERE movement_id = ?1)
                 AND EXISTS (SELECT 1 FROM po_lines WHERE id = ?2 AND custom_order_id IS NOT NULL)`,
            )
            .bind(row.movementId, line.poLineId),
        ]),
    ...receiptClaimStatements(
      db,
      { id: lineId, poLineId: line.poLineId, damaged: line.damaged, qcFailed: line.qcFailed },
      written,
    ),
  ];
}

type ReceiptRow = {
  id: string;
  po_id: string;
  received_by: string;
  received_at: string;
  supplier_invoice: string | null;
};
type LineRow = {
  receipt_id: string;
  po_line_id: string;
  received: number;
  damaged: number;
  qc_failed: number;
  lot_code: string | null;
  expires_on: string | null;
  landed_unit_paise: number;
};

/** The receipts against the orders named, oldest first. */
export async function receiptsOf(db: D1Database, orders: readonly string[]): Promise<Receipt[]> {
  const [receipts, lines] = await Promise.all([
    db
      .prepare(
        `SELECT id, po_id, received_by, received_at, supplier_invoice FROM receipts
         WHERE po_id IN (SELECT value FROM json_each(?1)) ORDER BY received_at, rowid`,
      )
      .bind(JSON.stringify(orders))
      .all<ReceiptRow>(),
    db
      .prepare(
        `SELECT l.receipt_id, l.po_line_id, l.received, l.damaged, l.qc_failed, l.lot_code, l.expires_on, l.landed_unit_paise
         FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id
         WHERE r.po_id IN (SELECT value FROM json_each(?1)) ORDER BY l.rowid`,
      )
      .bind(JSON.stringify(orders))
      .all<LineRow>(),
  ]);
  return receipts.results.map((row) => ({
    id: row.id,
    poId: row.po_id,
    receivedBy: row.received_by,
    receivedAt: row.received_at,
    supplierInvoice: row.supplier_invoice,
    lines: lines.results
      .filter((line) => line.receipt_id === row.id)
      .map((line) => ({
        poLineId: line.po_line_id,
        received: line.received,
        damaged: line.damaged,
        qcFailed: line.qc_failed,
        lotCode: line.lot_code,
        expiresOn: line.expires_on,
        landedUnitPaise: line.landed_unit_paise,
      })),
  }));
}

// Custom orders (docs/decisions/0174-custom-orders.md): a hair system made for one client to their exact spec, where no
// stock code is (./stock-match.ts). Ops raise one from the client's page with its supplier, the supplier's price, what
// the client pays and the date the supplier promised; the client pays it in full by a payment link
// (src/domain/money/custom-order-links.ts); only then is it ordered, on a purchase order of its own (./custom-order-po.ts).

import { latestFits } from "../clients/hair-profiles.ts";
import { auditStatement, auditStatementWhen } from "../platform/audit.ts";
import { MATCHED_FIELDS } from "../inventory/stock-match.ts";
import type { Written } from "../inventory/stock.ts";

/** Where an order stands, as ops and the client read it: its own state, and its purchase order's once paid. */
type CustomOrderStatus = "awaiting_payment" | "paid" | "ordered" | "arrived" | "refunded" | "cancelled";

export interface CustomOrder {
  readonly id: string;
  readonly number: number;
  readonly personId: string;
  readonly product: string;
  readonly baseWidthIn: number;
  readonly baseLengthIn: number;
  readonly colour: string;
  readonly greyPercent: number;
  readonly densityPercent: number;
  readonly wave: string | null;
  readonly note: string | null;
  readonly supplierId: string;
  readonly supplierPrice: number;
  readonly currency: string;
  readonly amount: number;
  readonly promisedOn: string | null;
  readonly status: CustomOrderStatus;
  readonly shortUrl: string | null;
  readonly linkSentAt: string | null;
  readonly paidAt: string | null;
  readonly poNumber: number | null;
  readonly refundReason: "not_ordered" | "late" | "failed_check" | null;
  readonly raisedAt: string;
}

type OrderRow = {
  id: string;
  number: number;
  person_id: string;
  product: string;
  base_width_in: number;
  base_length_in: number;
  colour: string;
  grey_percent: number;
  density_percent: number;
  wave: string | null;
  note: string | null;
  supplier_id: string;
  supplier_price: number;
  currency: string;
  amount: number;
  promised_on: string | null;
  state: "awaiting_payment" | "paid" | "cancelled";
  short_url: string | null;
  link_sent_at: string | null;
  paid_at: string | null;
  po_number: number | null;
  po_state: string | null;
  refunded_at: string | null;
  refund_reason: CustomOrder["refundReason"];
  raised_at: string;
};

const ORDER_SQL = `SELECT k.id, k.number, k.person_id, k.product, k.base_width_in, k.base_length_in, k.colour,
    k.grey_percent, k.density_percent, k.wave, k.note, k.supplier_id, k.supplier_price, s.currency, k.amount,
    k.promised_on, k.state, k.short_url, k.link_sent_at, k.paid_at, o.number AS po_number, o.state AS po_state,
    k.refunded_at, k.refund_reason, k.raised_at
  FROM custom_orders k JOIN suppliers s ON s.id = k.supplier_id LEFT JOIN purchase_orders o ON o.id = k.po_id`;

function statusOf(row: OrderRow): CustomOrderStatus {
  if (row.state !== "paid") return row.state;
  if (row.refunded_at !== null) return "refunded";
  if (row.po_state === "received") return "arrived";
  return row.po_state === "sent" || row.po_state === "part_received" ? "ordered" : "paid";
}

const orderOf = (row: OrderRow): CustomOrder => ({
  id: row.id,
  number: row.number,
  personId: row.person_id,
  product: row.product,
  baseWidthIn: row.base_width_in,
  baseLengthIn: row.base_length_in,
  colour: row.colour,
  greyPercent: row.grey_percent,
  densityPercent: row.density_percent,
  wave: row.wave,
  note: row.note,
  supplierId: row.supplier_id,
  supplierPrice: row.supplier_price,
  currency: row.currency,
  amount: row.amount,
  promisedOn: row.promised_on,
  status: statusOf(row),
  shortUrl: row.short_url,
  linkSentAt: row.link_sent_at,
  paidAt: row.paid_at,
  poNumber: row.po_number,
  refundReason: row.refund_reason,
  raisedAt: row.raised_at,
});

/** The client's custom orders, newest first. */
export async function customOrdersOf(db: D1Database, personId: string): Promise<CustomOrder[]> {
  const { results } = await db
    .prepare(`${ORDER_SQL} WHERE k.person_id = ?1 ORDER BY k.number DESC`)
    .bind(personId)
    .all<OrderRow>();
  return results.map(orderOf);
}

/** One custom order; null where there is none. */
export async function customOrder(db: D1Database, id: string): Promise<CustomOrder | null> {
  const row = await db.prepare(`${ORDER_SQL} WHERE k.id = ?1`).bind(id).first<OrderRow>();
  return row === null ? null : orderOf(row);
}

export interface NewCustomOrder {
  readonly personId: string;
  readonly supplierId: string;
  readonly supplierPrice: number;
  readonly amount: number;
  readonly promisedOn: string | null;
  readonly wave: string | null;
  readonly note: string | null;
}

/**
 * A custom order raised to the client's latest profile, awaiting payment. Refused, naming the field, for a profile
 * missing any part of the spec, or a supplier retired or gone.
 */
export async function raiseCustomOrder(
  db: D1Database,
  raised: NewCustomOrder,
  written: Written,
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly fields: string[] }> {
  const spec = (await latestFits(db, [raised.personId])).get(raised.personId);
  if (spec === undefined || MATCHED_FIELDS.some((field) => spec[field] === null))
    return { ok: false, fields: ["profile"] };
  const supplier = await db
    .prepare("SELECT 1 FROM suppliers WHERE id = ?1 AND retired_at IS NULL")
    .bind(raised.supplierId)
    .first();
  if (supplier === null) return { ok: false, fields: ["supplier_id"] };
  const id = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO custom_orders (id, number, person_id, product, base_width_in, base_length_in, colour, grey_percent,
           density_percent, wave, note, supplier_id, supplier_price, amount, promised_on, state, raised_by, raised_at,
           updated_at)
         SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
           'awaiting_payment', ?15, ?16, ?16
         FROM custom_orders`,
      )
      .bind(
        id,
        raised.personId,
        spec.product,
        spec.base_width_in,
        spec.base_length_in,
        spec.colour,
        spec.grey_percent,
        spec.density_percent,
        raised.wave,
        raised.note,
        raised.supplierId,
        raised.supplierPrice,
        raised.amount,
        raised.promisedOn,
        written.actor.id,
        at,
      ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "custom_order.raise",
        subject: { kind: "client", id: raised.personId },
        requestId: written.requestId,
        detail: { custom_order: id, amount: raised.amount },
      },
      written.now,
    ),
  ]);
  return { ok: true, id };
}

/** A custom order not yet paid, cancelled. Whether it was: a paid one is refunded instead, never cancelled. */
export async function cancelCustomOrder(db: D1Database, id: string, written: Written): Promise<boolean> {
  const at = written.now.toISOString();
  const [cancelled] = await db.batch([
    db
      .prepare(
        "UPDATE custom_orders SET state = 'cancelled', updated_at = ?2 WHERE id = ?1 AND state = 'awaiting_payment'",
      )
      .bind(id, at),
    auditStatementWhen(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "custom_order.cancel",
        subject: { kind: "custom_order", id },
        requestId: written.requestId,
      },
      written.now,
      {
        sql: "EXISTS (SELECT 1 FROM custom_orders WHERE id = ?10 AND state = 'cancelled' AND updated_at = ?11)",
        binds: [id, at],
      },
    ),
  ]);
  return cancelled?.meta.changes === 1;
}

/**
 * The pieces a kit holds reserved to another client's custom order than the visit's, by label, each with its stock
 * code: the piece step never offers them (docs/decisions/0175-custom-pieces-reserved.md).
 */
export async function reservedForOthers(
  db: D1Database,
  kit: string,
  appointmentId: string,
): Promise<Map<string, string>> {
  const { results } = await db
    .prepare(
      `SELECT u.code, u.consumable_code FROM stock_units u JOIN custom_orders k ON k.id = u.custom_order_id
       WHERE u.place = ?1 AND u.state = 'held' AND u.custom_order_id IS NOT NULL
         AND k.person_id IS NOT (SELECT person_id FROM appointments WHERE id = ?2)`,
    )
    .bind(kit, appointmentId)
    .all<{ code: string; consumable_code: string }>();
  return new Map(results.map((row) => [row.code, row.consumable_code]));
}

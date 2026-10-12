// A paid custom order's purchase order (docs/decisions/0174-custom-orders.md): the stock code made to its spec, found
// or added as ops add one, then a purchase order of its own to its supplier, one piece at the supplier's price, whose
// line names the custom order. It is drafted, and approved and sent as any order is (./purchase-orders.ts). Drafted
// once: a second word of the same payment finds the order drafted already.

import { addHairSystem, hairSystemSpecs, matchingCode } from "./hair-systems.ts";
import type { Written } from "./stock.ts";

type PaidRow = {
  number: number;
  product: string;
  base_width_in: number;
  base_length_in: number;
  colour: string;
  grey_percent: number;
  density_percent: number;
  supplier_id: string;
  currency: string;
  supplier_price: number;
  promised_on: string | null;
  po_id: string | null;
};

/** The stock code made exactly to the order's spec: the one ranged already, else one added for it. */
async function codeFor(db: D1Database, order: PaidRow, written: Written): Promise<string | null> {
  const found = matchingCode(await hairSystemSpecs(db), order);
  if (found !== null) return found;
  const added = await addHairSystem(
    db,
    {
      product: order.product,
      baseWidthIn: order.base_width_in,
      baseLengthIn: order.base_length_in,
      colour: order.colour,
      greyPercent: order.grey_percent,
      densityPercent: order.density_percent,
      unitCost: 0,
      reorderKit: null,
      reorderCentral: null,
    },
    written,
  );
  return added.ok ? added.code : null;
}

/** The paid order's purchase order, drafted where none is yet. Whether the order has one now. */
export async function draftCustomOrderPo(db: D1Database, orderId: string, written: Written): Promise<boolean> {
  const order = await db
    .prepare(
      `SELECT k.number, k.product, k.base_width_in, k.base_length_in, k.colour, k.grey_percent, k.density_percent,
         k.supplier_id, s.currency, k.supplier_price, k.promised_on, k.po_id
       FROM custom_orders k JOIN suppliers s ON s.id = k.supplier_id WHERE k.id = ?1 AND k.state = 'paid'`,
    )
    .bind(orderId)
    .first<PaidRow>();
  if (order === null) return false;
  if (order.po_id !== null) return true;
  const code = await codeFor(db, order, written);
  if (code === null) return false;
  const poId = crypto.randomUUID();
  const at = written.now.toISOString();
  const note = `Custom order CU-${String(order.number).padStart(4, "0")}`;
  const [, , kept] = await db.batch([
    db
      .prepare(
        `INSERT INTO purchase_orders (id, number, supplier_id, currency, state, expected_on, note, drafted_by, drafted_at,
           updated_at)
         SELECT ?1, COALESCE(MAX(number), 0) + 1, ?2, ?3, 'drafted', ?4, ?5, ?6, ?7, ?7 FROM purchase_orders
         WHERE NOT EXISTS (SELECT 1 FROM custom_orders WHERE id = ?8 AND po_id IS NOT NULL)`,
      )
      .bind(poId, order.supplier_id, order.currency, order.promised_on, note, written.actor.id, at, orderId),
    db
      .prepare(
        `INSERT INTO po_lines (id, po_id, consumable_code, quantity, unit_price, custom_order_id)
         SELECT ?1, ?2, ?3, 1, ?4, ?5 WHERE EXISTS (SELECT 1 FROM purchase_orders WHERE id = ?2)`,
      )
      .bind(crypto.randomUUID(), poId, code, order.supplier_price, orderId),
    db
      .prepare(
        `UPDATE custom_orders SET consumable_code = ?2, po_id = ?3, updated_at = ?4
         WHERE id = ?1 AND po_id IS NULL AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ?3)`,
      )
      .bind(orderId, code, poId, at),
  ]);
  return kept?.meta.changes === 1;
}

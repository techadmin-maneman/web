// Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from, on what terms, and for each stock code they
// supply their code, price, pack, minimum order and the lead time they promise. Each change is written with its audit
// entry in one batch. A supplier is retired, never deleted, since orders and bills will name it.

import { auditStatement, type AuditActor, type AuditAction } from "../platform/audit.ts";

export interface SupplierItem {
  readonly code: string;
  readonly theirCode: string | null;
  /** In the supplier's currency, in its smallest unit. */
  readonly unitPrice: number;
  readonly packSize: number;
  readonly minimumOrder: number;
  readonly leadTimeDays: number;
}

export interface SupplierFields {
  readonly name: string;
  readonly gstin: string | null;
  readonly country: string;
  readonly currency: string;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly paymentTermsDays: number;
  readonly warrantyDays: number;
}

export interface Supplier extends SupplierFields {
  readonly id: string;
  readonly retiredAt: string | null;
  readonly items: readonly SupplierItem[];
}

interface Written {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type SupplierRow = {
  id: string;
  name: string;
  gstin: string | null;
  country: string;
  currency: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  payment_terms_days: number;
  warranty_days: number;
  retired_at: string | null;
};

type ItemRow = {
  supplier_id: string;
  consumable_code: string;
  their_code: string | null;
  unit_price: number;
  pack_size: number;
  minimum_order: number;
  lead_time_days: number;
};

const SUPPLIER_COLUMNS = `id, name, gstin, country, currency, contact_name, contact_phone, contact_email,
  payment_terms_days, warranty_days, retired_at`;

const ITEM_COLUMNS = "supplier_id, consumable_code, their_code, unit_price, pack_size, minimum_order, lead_time_days";

/** Every supplier, by name, each with what it supplies. */
export async function allSuppliers(db: D1Database): Promise<Supplier[]> {
  const [suppliers, items] = await Promise.all([
    db.prepare(`SELECT ${SUPPLIER_COLUMNS} FROM suppliers ORDER BY name COLLATE NOCASE`).all<SupplierRow>(),
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM supplier_items ORDER BY consumable_code`).all<ItemRow>(),
  ]);
  return suppliers.results.map((row) => ({
    id: row.id,
    name: row.name,
    gstin: row.gstin,
    country: row.country,
    currency: row.currency,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    paymentTermsDays: row.payment_terms_days,
    warrantyDays: row.warranty_days,
    retiredAt: row.retired_at,
    items: items.results
      .filter((item) => item.supplier_id === row.id)
      .map((item) => ({
        code: item.consumable_code,
        theirCode: item.their_code,
        unitPrice: item.unit_price,
        packSize: item.pack_size,
        minimumOrder: item.minimum_order,
        leadTimeDays: item.lead_time_days,
      })),
  }));
}

const entry = (written: Written, action: AuditAction, id: string, detail: Record<string, string | number> = {}) => ({
  surface: "ops" as const,
  actor: written.actor,
  action,
  subject: { kind: "supplier", id },
  requestId: written.requestId,
  detail,
});

const nameTaken = async (db: D1Database, name: string, except: string | null) =>
  (await db
    .prepare("SELECT 1 FROM suppliers WHERE name = ?1 COLLATE NOCASE AND (?2 IS NULL OR id <> ?2)")
    .bind(name, except)
    .first()) !== null;

const valuesOf = (fields: SupplierFields) => [
  fields.name,
  fields.gstin,
  fields.country,
  fields.currency,
  fields.contactName,
  fields.contactPhone,
  fields.contactEmail,
  fields.paymentTermsDays,
  fields.warrantyDays,
];

/** A new supplier; refused, naming `name`, where another has its name. */
export async function addSupplier(
  db: D1Database,
  fields: SupplierFields,
  written: Written,
): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly fields: string[] }> {
  if (await nameTaken(db, fields.name, null)) return { ok: false, fields: ["name"] };
  const id = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    auditStatement(db, entry(written, "supplier.add", id), written.now),
    db
      .prepare(
        `INSERT INTO suppliers (id, name, gstin, country, currency, contact_name, contact_phone, contact_email,
           payment_terms_days, warranty_days, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`,
      )
      .bind(id, ...valuesOf(fields), at),
  ]);
  return { ok: true, id };
}

/** A supplier's record changed; refused for no such supplier, or a name another has. */
export async function changeSupplier(
  db: D1Database,
  id: string,
  fields: SupplierFields,
  written: Written,
): Promise<{ readonly ok: boolean; readonly fields: string[] }> {
  if (await nameTaken(db, fields.name, id)) return { ok: false, fields: ["name"] };
  const [, changed] = await db.batch([
    auditStatement(db, entry(written, "supplier.change", id), written.now),
    db
      .prepare(
        `UPDATE suppliers SET name = ?2, gstin = ?3, country = ?4, currency = ?5, contact_name = ?6, contact_phone = ?7,
           contact_email = ?8, payment_terms_days = ?9, warranty_days = ?10, updated_at = ?11
         WHERE id = ?1`,
      )
      .bind(id, ...valuesOf(fields), written.now.toISOString()),
  ]);
  return changed?.meta.changes === 1 ? { ok: true, fields: [] } : { ok: false, fields: ["id"] };
}

/** A supplier retired from new orders, or restored. Whether there was such a supplier. */
export async function retireSupplier(db: D1Database, id: string, retire: boolean, written: Written): Promise<boolean> {
  const at = written.now.toISOString();
  const [, changed] = await db.batch([
    auditStatement(db, entry(written, retire ? "supplier.retire" : "supplier.restore", id), written.now),
    db.prepare("UPDATE suppliers SET retired_at = ?2, updated_at = ?3 WHERE id = ?1").bind(id, retire ? at : null, at),
  ]);
  return changed?.meta.changes === 1;
}

/**
 * What a supplier supplies of one stock code, set afresh, or taken off its list (`item` null). Refused, naming the
 * field, for no such supplier or stock code.
 */
export async function setSupplierItem(
  db: D1Database,
  set: { readonly supplierId: string; readonly code: string; readonly item: Omit<SupplierItem, "code"> | null },
  written: Written,
): Promise<{ readonly ok: boolean; readonly fields: string[] }> {
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ?1").bind(set.supplierId).first();
  if (supplier === null) return { ok: false, fields: ["id"] };
  const known = await db.prepare("SELECT 1 FROM consumables WHERE code = ?1").bind(set.code).first();
  if (known === null) return { ok: false, fields: ["consumable_code"] };
  const action = set.item === null ? "supplier.item_remove" : "supplier.item_set";
  const audit = auditStatement(db, entry(written, action, set.supplierId, { consumable: set.code }), written.now);
  if (set.item === null) {
    await db.batch([
      audit,
      db
        .prepare("DELETE FROM supplier_items WHERE supplier_id = ?1 AND consumable_code = ?2")
        .bind(set.supplierId, set.code),
    ]);
    return { ok: true, fields: [] };
  }
  const { item } = set;
  await db.batch([
    audit,
    db
      .prepare(
        `INSERT INTO supplier_items (${ITEM_COLUMNS}, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (supplier_id, consumable_code) DO UPDATE SET their_code = excluded.their_code,
           unit_price = excluded.unit_price, pack_size = excluded.pack_size, minimum_order = excluded.minimum_order,
           lead_time_days = excluded.lead_time_days, updated_at = excluded.updated_at`,
      )
      .bind(
        set.supplierId,
        set.code,
        item.theirCode,
        item.unitPrice,
        item.packSize,
        item.minimumOrder,
        item.leadTimeDays,
        written.now.toISOString(),
      ),
  ]);
  return { ok: true, fields: [] };
}

// What a printed purchase order says of us: the legal name, the registered office and CIN, the GSTIN, and where the
// supplier delivers, as ops set it once on the Purchasing page (docs/decisions/0166-purchase-orders.md). One row, which
// each change replaces.

import { auditStatement, opsEntry, type Written } from "../platform/audit.ts";

export interface Letterhead {
  readonly legalName: string;
  /** The company's registered office, a line at a time; null for none to print. */
  readonly registeredOffice: string | null;
  /** The company's Corporate Identification Number; null for none to print. */
  readonly cin: string | null;
  /** Null for no GSTIN to print. */
  readonly gstin: string | null;
  /** The address the supplier delivers to, as it prints, a line at a time. */
  readonly deliverTo: string;
}

/** The letterhead ops set, or null before they have. */
export async function poLetterhead(db: D1Database): Promise<Letterhead | null> {
  const row = await db
    .prepare("SELECT legal_name, registered_office, cin, gstin, deliver_to FROM po_letterhead WHERE id = 1")
    .first<{
      legal_name: string;
      registered_office: string | null;
      cin: string | null;
      gstin: string | null;
      deliver_to: string;
    }>();
  if (row === null) return null;
  return {
    legalName: row.legal_name,
    registeredOffice: row.registered_office,
    cin: row.cin,
    gstin: row.gstin,
    deliverTo: row.deliver_to,
  };
}

export async function setPoLetterhead(db: D1Database, letterhead: Letterhead, written: Written): Promise<void> {
  const at = written.now.toISOString();
  await db.batch([
    auditStatement(
      db,
      opsEntry(written, "purchase_order.letterhead_set", { kind: "po_letterhead", id: "1" }),
      written.now,
    ),
    db
      .prepare(
        `INSERT INTO po_letterhead (id, legal_name, gstin, deliver_to, set_by, set_at, registered_office, cin)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET legal_name = ?1, gstin = ?2, deliver_to = ?3, set_by = ?4, set_at = ?5,
           registered_office = ?6, cin = ?7`,
      )
      .bind(
        letterhead.legalName,
        letterhead.gstin,
        letterhead.deliverTo,
        written.actor.id,
        at,
        letterhead.registeredOffice,
        letterhead.cin,
      ),
  ]);
}

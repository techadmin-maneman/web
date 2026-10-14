// Our GST registrations by state (docs/decisions/0198-cities-as-data.md). The one in BOOKS_GSTIN supplies every visit
// unless the visit's state has a registration of its own here; the place of supply is always the visit's city's
// state. Which registration supplies a visit across states is the CA's to confirm before a second is added.

import { placeOfSupply, type GstRegistration } from "../../config/gst.ts";
import { auditStatement, type AuditEntry } from "../platform/audit.ts";
import { cityStates } from "./cities.ts";

export interface StateRegistration {
  readonly state_code: string;
  readonly gstin: string;
  /** The Books branch its invoices are raised under; null for an organisation with no branches. */
  readonly books_branch_id: string | null;
  readonly added_by: string;
  readonly added_at: string;
}

export async function stateRegistrations(db: D1Database): Promise<StateRegistration[]> {
  const { results } = await db
    .prepare("SELECT state_code, gstin, books_branch_id, added_by, added_at FROM gst_registrations ORDER BY state_code")
    .all<StateRegistration>();
  return results;
}

/** What supplies a visit in a city: the place of supply, the GSTIN and the Books branch its invoice names. */
export interface Supply {
  readonly placeOfSupply: string | null;
  readonly branchId: string | null;
}

/** How a pass that raises many invoices works out each one's supply: the cities' states and the registrations, read once. */
export async function supplyFor(db: D1Database, head: GstRegistration): Promise<(city: string | null) => Supply> {
  const [states, registrations] = await Promise.all([cityStates(db), stateRegistrations(db)]);
  return (city) => {
    const state = city === null ? null : (states.get(city) ?? null);
    const own = registrations.find((each) => each.state_code === state?.code);
    return {
      placeOfSupply: placeOfSupply(state?.code ?? null, head),
      branchId: head.gstin === null ? null : (own?.books_branch_id ?? null),
    };
  };
}

/** A registration added for a state, or changed, with its audit entry in the same batch. */
export async function setRegistration(
  db: D1Database,
  registration: { readonly stateCode: string; readonly gstin: string; readonly booksBranchId: string | null },
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<"set" | "held"> {
  const held = await db
    .prepare("SELECT 1 FROM gst_registrations WHERE gstin = ?1 AND state_code <> ?2")
    .bind(registration.gstin, registration.stateCode)
    .first();
  if (held !== null) return "held";
  await db.batch([
    db
      .prepare(
        `INSERT INTO gst_registrations (state_code, gstin, books_branch_id, added_by, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (state_code) DO UPDATE SET gstin = excluded.gstin, books_branch_id = excluded.books_branch_id`,
      )
      .bind(registration.stateCode, registration.gstin, registration.booksBranchId, audit.actor.id, now.toISOString()),
    auditStatement(
      db,
      { ...audit, action: "gst_registration.set", subject: { kind: "gst_registration", id: registration.stateCode } },
      now,
    ),
  ]);
  return "set";
}

/** A state's registration taken off: its visits are supplied from the registration in BOOKS_GSTIN again. */
export async function removeRegistration(
  db: D1Database,
  stateCode: string,
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<boolean> {
  const held = await db.prepare("SELECT 1 FROM gst_registrations WHERE state_code = ?1").bind(stateCode).first();
  if (held === null) return false;
  await db.batch([
    db.prepare("DELETE FROM gst_registrations WHERE state_code = ?1").bind(stateCode),
    auditStatement(
      db,
      { ...audit, action: "gst_registration.remove", subject: { kind: "gst_registration", id: stateCode } },
      now,
    ),
  ]);
  return true;
}

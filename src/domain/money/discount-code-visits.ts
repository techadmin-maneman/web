// A discount code entered on a visit by the technician or ops, taken off it, and let go when the client declines
// the fit (./discount-code-uses.ts, docs/decisions/0108-discount-codes.md).

import { STANDARD_TIER, type VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { OneVisitState } from "../../policy/one-visit.ts";
import { creditSpentOn } from "../visits/visit-facts.ts";
import {
  type EnteredBy,
  enteredAs,
  type Entered,
  codeOnVisit,
  checkDiscountCode,
  type ByOps,
  openVisit,
  useStatement,
  type Removed,
} from "./discount-code-uses.ts";
import { type Price, priceOf } from "./price-book.ts";
import { amountOff } from "../../policy/discount-codes.ts";
import { auditStatementIfWritten, type AuditEntry, auditStatementIfStamped } from "../ops/audit.ts";
import { termsOf } from "./discount-codes.ts";
import { typedForVisit } from "./requested-codes.ts";

// ---------------------------------------------------------------------------
// A visit: the technician's one visit, or any visit ops enter a code on
// ---------------------------------------------------------------------------
interface VisitRow {
  id: string;
  person_id: string | null;
  type: VisitType | null;
  tier: string | null;
  window_start: string | null;
  one_visit: OneVisitState | null;
  status: string;
  open: number;
  on_credit: number;
}

async function visitOf(db: D1Database, visitId: string): Promise<VisitRow | null> {
  return db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, a.one_visit, a.status,
         (${openVisit("a.id")}) AS open,
         ${creditSpentOn("a.id")} AS on_credit
       FROM appointments a WHERE a.id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(visitId)
    .first<VisitRow>();
}

/** A visit cancelled or ended unfinished takes no code: nothing will be sold at it. */
const TAKES_A_CODE = new Set(["scheduled", "dispatched", "in_progress", "completed"]);
/** The visit's own price in the book on its day: its service's, or a one visit's product once chosen. */
async function priceOfVisit(db: D1Database, visit: VisitRow): Promise<Price | null> {
  if (visit.type === null || visit.window_start === null || visit.one_visit === "booked") return null;
  return priceOf(db, visit.type, indiaDate(new Date(visit.window_start)), visit.tier ?? STANDARD_TIER);
}

/**
 * The technician, on a one visit before its payment link is made, or ops, on any visit not yet paid for, linked or
 * invoiced, enter a code on the visit. What it takes off is fixed now where the visit's price is known, and at the
 * payment link for a one visit whose product is still to be chosen. The code the client typed on /book for a one
 * visit is honoured as it stood when typed. Ops' entry is audited in the same batch.
 */
export async function enterOnVisit(
  db: D1Database,
  entry: { readonly visitId: string; readonly text: string; readonly by: EnteredBy; readonly requestId?: string },
  now: Date,
): Promise<Entered> {
  const visit = await visitOf(db, entry.visitId);
  if (visit === null) return { kind: "not_found" };
  const { person_id: personId, type } = visit;
  if (personId === null || type === null) return { kind: "not_found" };
  if (visit.open !== 1 || !TAKES_A_CODE.has(visit.status)) return { kind: "price_settled" };
  if ((await codeOnVisit(db, visit.id)) !== null) return { kind: "already_discounted" };

  const typedAt = visit.one_visit === null ? null : await typedForVisit(db, visit.id, entry.text);
  const checked = await checkDiscountCode({
    db,
    text: entry.text,
    booking: { type, onCredit: visit.on_credit === 1, moves: false },
    personId,
    now,
    typedAt: typedAt ?? now,
  });
  if (!checked.ok) return { kind: "not_applicable", reason: checked.reason };

  const price = await priceOfVisit(db, visit);
  const use = {
    id: crypto.randomUUID(),
    codeId: checked.code.id,
    personId,
    holdId: null,
    visitId: visit.id,
    amountOff: price === null ? null : amountOff(termsOf(checked.code), price.amount_ex_gst),
    by: entry.by,
    typedAt: typedAt ?? now,
  };
  const { by } = entry;
  const audit = by.kind === "ops" ? [visitAudit("discount_code.apply", by, entry, checked.code.code)] : [];
  await db.batch([
    useStatement(db, use, "open_visit", now),
    ...audit.map((each) => auditStatementIfWritten(db, each, now, { table: "discount_code_uses", id: use.id })),
  ]);
  return enteredAs(db, use.id, checked.code.code);
}

/** Ops' entry for a code entered on a visit or taken off it: the visit's ID and the code, and nothing else. */
function visitAudit(
  action: "discount_code.apply" | "discount_code.remove",
  by: ByOps,
  entry: { readonly visitId: string; readonly requestId?: string },
  code: string,
): AuditEntry {
  return {
    surface: "ops",
    actor: by.actor,
    action,
    subject: { kind: "appointment", id: entry.visitId },
    requestId: entry.requestId ?? null,
    detail: { code },
  };
}

/** Ops take the code off a visit not yet paid for, linked or invoiced: its use is marked removed, and audited. */
export async function removeFromVisit(
  db: D1Database,
  entry: { readonly visitId: string; readonly by: ByOps; readonly requestId: string },
  now: Date,
): Promise<Exclude<Removed, "expired">> {
  const visit = await visitOf(db, entry.visitId);
  if (visit === null) return "not_found";
  if (visit.open !== 1) return "price_settled";
  const code = await codeOnVisit(db, visit.id);
  if (code === null) return "none";
  const removal = visitAudit("discount_code.remove", entry.by, entry, code.code);
  await db.batch([
    db
      .prepare(
        `UPDATE discount_code_uses SET removed_at = ?2, removed_by = 'ops', removed_by_id = ?3
         WHERE id = ?1 AND removed_at IS NULL AND ${openVisit("?4")}`,
      )
      .bind(code.useId, now.toISOString(), entry.by.actor.id, visit.id),
    auditStatementIfStamped(db, removal, now, { table: "discount_code_uses", column: "removed_at", id: code.useId }),
  ]);
  return "removed";
}

/**
 * The code on a one visit the client decided against, taken off by the system: nothing was sold, so the code is the
 * client's to use again, and counts against its limits no more.
 */
export function releaseDeclined(db: D1Database, visitId: string, now: Date): D1PreparedStatement[] {
  const removed = "removed_at = ?2, removed_by = 'system', removed_by_id = 'declined'";
  return [
    db
      .prepare(`UPDATE discount_code_uses SET ${removed} WHERE appointment_id = ?1 AND removed_at IS NULL`)
      .bind(visitId, now.toISOString()),
    db
      .prepare(
        `UPDATE discount_code_uses SET ${removed}
         WHERE hold_id IN (SELECT h.id FROM slot_holds h WHERE h.appointment_id = ?1) AND removed_at IS NULL`,
      )
      .bind(visitId, now.toISOString()),
  ];
}

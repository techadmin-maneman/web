// A discount code entered on a booking (docs/decisions/0108-discount-codes.md; the rules are
// src/policy/discount-codes.ts). It is entered while the booking's price is still open: by the client on their hold
// at the app's pay step, or on the site's form for a consultation and fit in one visit (src/domain/discount-code-holds.ts);
// by the technician on a one visit before its payment link is made; by ops on a visit not yet paid for, linked or
// invoiced. A booking takes one code.
//
// Each time a code is entered is a use, and every use is kept: one taken off its booking is marked removed. What a
// use takes off is fixed once the price is known: as it is entered, on a hold or on a visit whose service is priced;
// at the payment link, for a one visit, whose product the client chooses at the visit. The hold, the link, the payment
// and the invoice then carry the discounted price.

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import {
  amountOff,
  codeRefusal,
  discounted,
  normalisedCode,
  type CodeBooking,
  type CodeRefusal,
  type DiscountKind,
  type DiscountTerms,
} from "../policy/discount-codes.ts";
import type { OneVisitState } from "../policy/one-visit.ts";
import { auditStatementIfStamped, auditStatementIfWritten, type AuditEntry } from "./audit.ts";
import { CODE_COLUMNS, coversOf, standing, termsOf, type CodeRow } from "./discount-codes.ts";
import { priceOf, type Price } from "./price-book.ts";

/** Who entered a code on a booking. */
export type GivenBy = "client" | "technician" | "ops";

export interface EnteredBy {
  readonly kind: GivenBy;
  /** The client's or the technician's ID, or the Access identity of ops. */
  readonly id: string;
}

/** The client's hold, `hold` naming its ID in the query, while its price may change: no order, nothing paid. */
export const unpaidHold = (hold: string): string =>
  `EXISTS (SELECT 1 FROM slot_holds open_hold WHERE open_hold.id = ${hold} AND open_hold.state = 'held'
     AND open_hold.confirmed_at IS NULL AND open_hold.razorpay_order_id IS NULL)`;

/**
 * A visit, `visit` naming its ID in the query, while its price may change: not invoiced, not paid for, and no payment
 * link made for it. A refunded payment was a payment.
 */
const openVisit = (visit: string): string =>
  `EXISTS (SELECT 1 FROM appointments open_visit WHERE open_visit.id = ${visit} AND open_visit.deleted_at IS NULL
     AND open_visit.fsm_invoice_id IS NULL AND open_visit.invoice_issued_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM payments paid WHERE paid.appointment_id = ${visit} AND paid.kind = 'visit'
     AND paid.status IN ('captured', 'refunded', 'partially_refunded'))
   AND NOT EXISTS (SELECT 1 FROM payment_links link WHERE link.appointment_id = ${visit})`;

// ---------------------------------------------------------------------------
// Whether a code applies, and the use that records it
// ---------------------------------------------------------------------------

/** Why a code was refused: one of the policy's reasons, or no such code. Logged, never told. */
export type Refused = CodeRefusal | "unknown";

/** A code entered on a booking: the code it is, or why it does not apply. */
export type Checked = { readonly ok: true; readonly code: CodeRow } | { readonly ok: false; readonly reason: Refused };

/** The code a text names, and whether it applies to the booking for this client, its limits read as they stand now. */
export async function checkCode(
  db: D1Database,
  text: string,
  booking: CodeBooking,
  personId: string,
  now: Date,
): Promise<Checked> {
  const code = await db
    .prepare(`SELECT ${CODE_COLUMNS} FROM discount_codes c WHERE c.code = ?1`)
    .bind(normalisedCode(text))
    .first<CodeRow>();
  if (code === null) return { ok: false, reason: "unknown" };
  const counted = await db
    .prepare(
      `SELECT COUNT(*) AS uses, COALESCE(SUM(u.person_id = ?2), 0) AS theirs FROM discount_code_uses u
       WHERE u.code_id = ?1 AND ${standing("u", "?3")}`,
    )
    .bind(code.id, personId, now.toISOString())
    .first<{ uses: number; theirs: number }>();
  const state = {
    switchedOff: code.switched_off_at !== null,
    expiresOn: code.expires_on,
    covers: coversOf(code),
    maxUses: code.max_uses,
    uses: counted?.uses ?? 0,
    oncePerClient: code.once_per_client === 1,
    usedByClient: (counted?.theirs ?? 0) > 0,
  };
  const refusal = codeRefusal(state, booking, indiaDate(now));
  return refusal === null ? { ok: true, code } : { ok: false, reason: refusal };
}

/** A use about to be written. */
export interface NewUse {
  readonly id: string;
  readonly codeId: string;
  readonly personId: string;
  readonly holdId: string | null;
  readonly visitId: string | null;
  /** Paise before GST; null while the booking's price is not known. */
  readonly amountOff: number | null;
  readonly by: EnteredBy;
}

/** What must still be true of the booking a use is written on, in the use's own statement. */
const STILL_OPEN = {
  // The client's hold at the pay step.
  unpaid_hold: unpaidHold("?4"),
  // The hold the site's form makes in the same batch, which nothing has priced yet.
  new_hold: "1 = 1",
  // A visit, entered on by the technician or ops.
  open_visit: openVisit("?5"),
} as const;

/**
 * The use, written only while the code is on and within its limits, the booking still open and carrying no other
 * code: each read again as it is written, so two entries at once cannot both take a code's last use.
 */
export function useStatement(
  db: D1Database,
  use: NewUse,
  onto: keyof typeof STILL_OPEN,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, hold_id, appointment_id, amount_off, given_by,
         given_by_id, created_at)
       SELECT ?1, c.id, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM discount_codes c
       WHERE c.id = ?2 AND c.switched_off_at IS NULL AND ${STILL_OPEN[onto]}
         AND (c.max_uses IS NULL OR c.max_uses > (SELECT COUNT(*) FROM discount_code_uses u
           WHERE u.code_id = c.id AND ${standing("u", "?9")}))
         AND (c.once_per_client = 0 OR NOT EXISTS (SELECT 1 FROM discount_code_uses u
           WHERE u.code_id = c.id AND u.person_id = ?3 AND ${standing("u", "?9")}))
         AND NOT EXISTS (SELECT 1 FROM discount_code_uses u WHERE u.removed_at IS NULL
           AND (u.hold_id = ?4 OR u.appointment_id = ?5
             OR u.hold_id IN (SELECT h.id FROM slot_holds h WHERE h.appointment_id = ?5)))`,
    )
    .bind(
      use.id,
      use.codeId,
      use.personId,
      use.holdId,
      use.visitId,
      use.amountOff,
      use.by.kind,
      use.by.id,
      now.toISOString(),
    );
}

/** What entering a code on a booking came to. */
export type Entered =
  | { readonly kind: "applied"; readonly code: string }
  | { readonly kind: "not_applicable"; readonly reason: Refused | "taken_meanwhile" }
  /** The booking carries a code already: one code per booking. */
  | { readonly kind: "already_discounted" }
  /** Its price is settled: Checkout has its order, it is paid for, its link is made, it is invoiced, or it is gone. */
  | { readonly kind: "price_settled" }
  /** The hold ran out of time before the code was entered. */
  | { readonly kind: "expired" }
  | { readonly kind: "not_found" };

/** Applied once its use is written; a use not written lost the code's last use, or the booking, a moment before. */
export async function enteredAs(db: D1Database, useId: string, code: string): Promise<Entered> {
  const row = await db.prepare("SELECT 1 FROM discount_code_uses WHERE id = ?1").bind(useId).first();
  return row === null ? { kind: "not_applicable", reason: "taken_meanwhile" } : { kind: "applied", code };
}

/** What taking a code off came to. */
export type Removed = "removed" | "none" | "price_settled" | "expired" | "not_found";

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
         (EXISTS (SELECT 1 FROM slot_holds h WHERE h.appointment_id = a.id AND h.use_credit = 1)
           OR EXISTS (SELECT 1 FROM credit_ledger l
             WHERE l.kind = 'redeem' AND l.source_kind = 'appointment' AND l.source_id = a.id)) AS on_credit
       FROM appointments a WHERE a.id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(visitId)
    .first<VisitRow>();
}

/** A visit FSM has cancelled or ended unfinished takes no code: nothing will be sold at it. */
const TAKES_A_CODE = new Set(["scheduled", "dispatched", "in_progress", "completed"]);

/** A visit's code, entered on it or on the hold that booked it. */
export interface VisitCode {
  readonly useId: string;
  readonly code: string;
  readonly terms: DiscountTerms;
  /** Paise before GST; null until the visit's price is known. */
  readonly amountOff: number | null;
  readonly givenBy: GivenBy;
}

export async function codeOnVisit(db: D1Database, visitId: string): Promise<VisitCode | null> {
  const row = await db
    .prepare(
      `SELECT u.id, c.code, c.kind, c.value, c.cap, u.amount_off, u.given_by
       FROM discount_code_uses u JOIN discount_codes c ON c.id = u.code_id
       WHERE u.removed_at IS NULL AND (u.appointment_id = ?1
         OR u.hold_id IN (SELECT h.id FROM slot_holds h WHERE h.appointment_id = ?1 AND h.state = 'booked'))
       ORDER BY u.created_at LIMIT 1`,
    )
    .bind(visitId)
    .first<{
      id: string;
      code: string;
      kind: DiscountKind;
      value: number;
      cap: number | null;
      amount_off: number | null;
      given_by: GivenBy;
    }>();
  if (row === null) return null;
  return { useId: row.id, code: row.code, terms: termsOf(row), amountOff: row.amount_off, givenBy: row.given_by };
}

/** The visit's own price in the book on its day: its service's, or a one visit's product once chosen. */
async function priceOfVisit(db: D1Database, visit: VisitRow): Promise<Price | null> {
  if (visit.type === null || visit.window_start === null || visit.one_visit === "booked") return null;
  return priceOf(db, visit.type, indiaDate(new Date(visit.window_start)), visit.tier ?? undefined);
}

/**
 * The technician, on a one visit before its payment link is made, or ops, on any visit not yet paid for, linked or
 * invoiced, enter a code on the visit. What it takes off is fixed now where the visit's price is known, and at the
 * payment link for a one visit whose product is still to be chosen. Ops' entry is audited in the same batch.
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

  const checked = await checkCode(
    db,
    entry.text,
    { type, onCredit: visit.on_credit === 1, moves: false },
    personId,
    now,
  );
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
  };
  const audit = entry.by.kind === "ops" ? [visitAudit("discount_code.apply", entry, checked.code.code)] : [];
  await db.batch([
    useStatement(db, use, "open_visit", now),
    ...audit.map((each) => auditStatementIfWritten(db, each, now, { table: "discount_code_uses", id: use.id })),
  ]);
  return enteredAs(db, use.id, checked.code.code);
}

/** Ops' entry for a code entered on a visit or taken off it: the visit's ID and the code, and nothing else. */
function visitAudit(
  action: "discount_code.apply" | "discount_code.remove",
  entry: { readonly visitId: string; readonly by: EnteredBy; readonly requestId?: string },
  code: string,
): AuditEntry {
  return {
    surface: "ops",
    actor: { kind: "staff", id: entry.by.id },
    action,
    subject: { kind: "appointment", id: entry.visitId },
    requestId: entry.requestId ?? null,
    detail: { code },
  };
}

/** Ops take the code off a visit not yet paid for, linked or invoiced: its use is marked removed, and audited. */
export async function removeFromVisit(
  db: D1Database,
  entry: { readonly visitId: string; readonly by: EnteredBy; readonly requestId: string },
  now: Date,
): Promise<Exclude<Removed, "expired">> {
  const visit = await visitOf(db, entry.visitId);
  if (visit === null) return "not_found";
  if (visit.open !== 1) return "price_settled";
  const code = await codeOnVisit(db, visit.id);
  if (code === null) return "none";
  const removal = visitAudit("discount_code.remove", entry, code.code);
  await db.batch([
    db
      .prepare(
        `UPDATE discount_code_uses SET removed_at = ?2, removed_by = ?3, removed_by_id = ?4
         WHERE id = ?1 AND removed_at IS NULL AND ${openVisit("?5")}`,
      )
      .bind(code.useId, now.toISOString(), entry.by.kind, entry.by.id, visit.id),
    auditStatementIfStamped(db, removal, now, { table: "discount_code_uses", column: "removed_at", id: code.useId }),
  ]);
  return "removed";
}

/** A visit's code as the client's page shows it, and whether ops may still enter or take off one. */
export interface ClientVisitCode {
  readonly code: { readonly code: string; readonly amount_off: number | null; readonly given_by: GivenBy } | null;
  /** Not yet paid for, linked or invoiced. */
  readonly open: boolean;
}

/** Every visit of the client's, by its ID, with its code and whether its price is still open. */
export async function clientVisitCodes(db: D1Database, personId: string): Promise<Map<string, ClientVisitCode>> {
  const { results } = await db
    .prepare(
      `WITH visit_codes AS (
         SELECT COALESCE(u.appointment_id, h.appointment_id) AS visit_id, c.code, u.amount_off, u.given_by
         FROM discount_code_uses u JOIN discount_codes c ON c.id = u.code_id
         LEFT JOIN slot_holds h ON h.id = u.hold_id AND h.state = 'booked'
         WHERE u.person_id = ?1 AND u.removed_at IS NULL)
       SELECT a.id, (${openVisit("a.id")}) AS open, vc.code, vc.amount_off, vc.given_by
       FROM appointments a LEFT JOIN visit_codes vc ON vc.visit_id = a.id
       WHERE a.person_id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(personId)
    .all<{ id: string; open: number; code: string | null; amount_off: number | null; given_by: GivenBy | null }>();
  return new Map(
    results.map((row) => [
      row.id,
      {
        code:
          row.code === null || row.given_by === null
            ? null
            : { code: row.code, amount_off: row.amount_off, given_by: row.given_by },
        open: row.open === 1,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------
// The price a code leaves, at the payment link and the invoice
// ---------------------------------------------------------------------------

/**
 * The visit's price with its code taken off, and the statement that fixes what the code took where that was not yet
 * known, to run with whatever charges the price: a one visit's payment link, or its invoice.
 */
export async function priceAfterCode(
  db: D1Database,
  visitId: string,
  price: Price,
): Promise<{ readonly price: Price; readonly off: number; readonly fix: D1PreparedStatement[] }> {
  const code = await codeOnVisit(db, visitId);
  if (code === null) return { price, off: 0, fix: [] };
  const off = code.amountOff ?? amountOff(code.terms, price.amount_ex_gst);
  const fix =
    code.amountOff === null
      ? [
          db
            .prepare("UPDATE discount_code_uses SET amount_off = ?2 WHERE id = ?1 AND amount_off IS NULL")
            .bind(code.useId, off),
        ]
      : [];
  return { price: discounted(price, off), off, fix };
}

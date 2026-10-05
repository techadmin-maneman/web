// A client's payments, refunds and credits, as the app lists them (docs/decisions/0044-payments-mirror.md), from
// the payments mirror and the credit ledger. Ops read the same list on the client's page. The routes are
// src/routes/client/payments.ts; what an amount means is said there.

import { exGst } from "../config/gst.ts";
import type { VISIT_TYPES } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { noShowNotes, type NoShowNote } from "./no-shows.ts";

export const CREDIT_EVENTS = ["added", "used", "lost", "returned", "expired", "withdrawn", "corrected"] as const;
type CreditEvent = (typeof CREDIT_EVENTS)[number];

export const REFERRAL_SIDES = ["referrer", "friend"] as const;
type ReferralSide = (typeof REFERRAL_SIDES)[number];

interface VisitColumns {
  appointment_id: string | null;
  window_start: string | null;
  type: (typeof VISIT_TYPES)[number] | null;
}

/** The GST rate a payment was sold at; null for one no hold or link priced. */
interface RateColumns {
  gst_percent: number | null;
}

/** The hold the payment was made for, found by its Razorpay order. */
interface HeldColumns {
  held_type: (typeof VISIT_TYPES)[number] | null;
  held_date: string | null;
  held_state: string | null;
}

interface PaymentRow extends VisitColumns, RateColumns, HeldColumns {
  id: string;
  reference: string | null;
  created_at: string;
  amount: number;
  amount_ex_gst: number | null;
  refunded_amount: number;
  status: "authorized" | "captured" | "refunded" | "partially_refunded";
  method: string | null;
  invoice_issued_at: string | null;
  books_payment_id: string | null;
  kind: "visit" | "late_fee";
  charged_change: "moved" | "replaced" | "cancelled" | null;
  charged_at: string | null;
  charged_visit_start: string | null;
  charged_amount: number | null;
}

interface RefundRow extends VisitColumns, RateColumns, HeldColumns {
  id: string;
  payment_id: string;
  created_at: string;
  amount: number;
  status: "created" | "processed" | "failed";
  speed: string | null;
  method: string | null;
}

const VISIT_JOIN = `LEFT JOIN appointments a ON a.id = p.appointment_id AND a.deleted_at IS NULL
  LEFT JOIN slot_holds h ON h.razorpay_order_id = p.razorpay_order_id`;

const HELD_COLUMNS = "h.type AS held_type, h.date AS held_date, h.state AS held_state";

// The change that kept a payment, if any: a late cancel or move keeps the visit's payment, or its late fee.
const PAYMENT_QUERY = `SELECT p.id, p.reference, p.created_at, p.amount, p.amount_ex_gst, p.gst_percent,
    p.refunded_amount, p.status, p.method,
    p.books_payment_id, p.kind, a.id AS appointment_id, a.window_start, a.type, a.invoice_issued_at,
    c.kind AS charged_change, c.created_at AS charged_at, c.was_start AS charged_visit_start,
    c.kept_amount AS charged_amount, ${HELD_COLUMNS}
  FROM payments p ${VISIT_JOIN}
  LEFT JOIN visit_changes c ON c.payment_id = p.id AND c.notice = 'late' AND c.kept_amount > 0
  WHERE p.person_id = ?1 AND p.status != 'failed'`;

const REFUND_QUERY = `SELECT r.id, r.payment_id, r.created_at, r.amount, r.status, r.speed, p.method, p.gst_percent,
    a.id AS appointment_id, a.window_start, a.type, ${HELD_COLUMNS}
  FROM refunds r JOIN payments p ON p.id = r.payment_id ${VISIT_JOIN}
  WHERE p.person_id = ?1`;

// The code a visit's payment was made with: one entered on the visit, or on the hold that booked it or that
// Checkout's order was made for. A late fee takes none.
const CODE_QUERY = `SELECT p.id AS payment_id, d.code, u.amount_off
  FROM payments p
  JOIN discount_code_uses u ON u.person_id = p.person_id AND u.removed_at IS NULL
  JOIN discount_codes d ON d.id = u.code_id
  LEFT JOIN slot_holds h ON h.id = u.hold_id
  WHERE p.person_id = ?1 AND p.kind = 'visit' AND p.status != 'failed'
    AND (u.appointment_id = p.appointment_id
      OR (h.state = 'booked' AND h.appointment_id = p.appointment_id)
      OR h.razorpay_order_id = p.razorpay_order_id)`;

/** A payment's discount code, and what it took off in paise before GST; null where the price was not known. */
interface PaymentCode {
  readonly code: string;
  readonly amount_off: number | null;
}

interface CodeRow {
  payment_id: string;
  code: string;
  amount_off: number | null;
}

/** What a payment's own row does not hold: the no-show note of its visit, and the code it was made with. */
interface PaymentNotes {
  readonly noShows: ReadonlyMap<string, NoShowNote>;
  readonly codes: ReadonlyMap<string, PaymentCode>;
}

/** The codes the person's visit payments were made with, by payment; only the one payment's, given its ID. */
async function codesOf(db: D1Database, personId: string, paymentId: string | null = null) {
  const statement =
    paymentId === null
      ? db.prepare(CODE_QUERY).bind(personId)
      : db.prepare(`${CODE_QUERY} AND p.id = ?2`).bind(personId, paymentId);
  const { results } = await statement.all<CodeRow>();
  return new Map<string, PaymentCode>(
    results.map((row) => [row.payment_id, { code: row.code, amount_off: row.amount_off }]),
  );
}

/** The visit an entry was for, when we know it. */
const visitRefOf = (row: VisitColumns) =>
  row.appointment_id === null || row.window_start === null
    ? null
    : { id: row.appointment_id, date: indiaDate(new Date(row.window_start)), type: row.type };

/** What a payment with no visit yet was for: its hold's booking, and whether that is still being made. */
function bookingOf(row: VisitColumns & HeldColumns) {
  if (visitRefOf(row) !== null) return null;
  if (row.held_type === null || row.held_date === null) return null;
  return { type: row.held_type, date: row.held_date, under_way: row.held_state === "held" };
}

/** The split before GST, at the rate the amount was sold at; both null where no rate was recorded. */
function gstSplitOf(row: RateColumns & { amount: number; amount_ex_gst?: number | null }) {
  if (row.gst_percent === null) return { amount_ex_gst: null, gst_percent: null };
  return { amount_ex_gst: row.amount_ex_gst ?? exGst(row.amount, row.gst_percent), gst_percent: row.gst_percent };
}

type MoneyColumns = VisitColumns &
  RateColumns &
  HeldColumns & { created_at: string; amount: number; amount_ex_gst?: number | null };

function moneyOf(row: MoneyColumns) {
  return {
    date: indiaDate(new Date(row.created_at)),
    amount: row.amount,
    ...gstSplitOf(row),
    visit: visitRefOf(row),
    booking: bookingOf(row),
  };
}

const paymentOf = (row: PaymentRow, notes: PaymentNotes) => ({
  kind: "payment" as const,
  id: row.id,
  ...moneyOf(row),
  status: row.status,
  method: row.method,
  reference: row.reference,
  refunded_amount: row.refunded_amount,
  purpose: row.kind,
  charge:
    row.charged_change === null || row.charged_at === null || row.charged_visit_start === null
      ? null
      : {
          change: row.charged_change === "cancelled" ? ("cancelled" as const) : ("moved" as const),
          at: row.charged_at,
          visit_started_at: row.charged_visit_start,
          amount: row.charged_amount ?? 0,
        },
  no_show: row.kind === "visit" && row.appointment_id !== null ? (notes.noShows.get(row.appointment_id) ?? null) : null,
  discount_code: notes.codes.get(row.id) ?? null,
});

const refundOf = (row: RefundRow) => ({
  kind: "refund" as const,
  id: row.id,
  payment_id: row.payment_id,
  ...moneyOf(row),
  status: row.status,
  destination: row.method,
  speed: row.speed,
});

/** The no-show notes of the visits these payments paid for. */
const noShowsOf = (db: D1Database, rows: readonly PaymentRow[], now: Date) =>
  noShowNotes(
    db,
    rows.flatMap((row) => (row.appointment_id === null ? [] : [row.appointment_id])),
    now,
  );

/** A person's payments and refunds as one list, newest first. Ops read the same list on the client's page. */
export async function paymentEntries(db: D1Database, personId: string, now: Date) {
  const [payments, refunds, codes] = await Promise.all([
    db.prepare(PAYMENT_QUERY).bind(personId).all<PaymentRow>(),
    db.prepare(REFUND_QUERY).bind(personId).all<RefundRow>(),
    codesOf(db, personId),
  ]);
  const notes = { noShows: await noShowsOf(db, payments.results, now), codes };
  return [
    ...payments.results.map((row) => ({ at: row.created_at, entry: paymentOf(row, notes) })),
    ...refunds.results.map((row) => ({ at: row.created_at, entry: refundOf(row) })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ entry }) => entry);
}

interface CreditRow extends VisitColumns {
  id: string;
  kind: "grant" | "redeem" | "restore" | "expire" | "clawback" | "adjust";
  visits: number;
  source_kind: "referral" | "appointment" | "ops" | "import";
  referral_side: ReferralSide | null;
  created_at: string;
  cancelled_late: number;
  restored: number;
}

/**
 * The ledger's entries for the person, newest first, with the visit each was for. An entry that changed nothing,
 * a spent grant closed at its expiry, is left out. A cancel inside 24 hours is read from the visit's own change,
 * and a credit given back from the ledger's own restore. A grant from an invite says which side of it the person
 * was: the friend who was fitted through it, or the referrer who sent it.
 */
const CREDIT_QUERY = `SELECT l.id, l.kind, l.visits, l.source_kind, l.created_at,
    CASE WHEN r.id IS NULL THEN NULL WHEN r.referred_person_id = l.person_id THEN 'friend' ELSE 'referrer' END
      AS referral_side,
    a.id AS appointment_id, a.window_start, a.type,
    EXISTS (SELECT 1 FROM visit_changes c
      WHERE c.appointment_id = l.source_id AND c.kind = 'cancelled' AND c.notice = 'late') AS cancelled_late,
    EXISTS (SELECT 1 FROM credit_ledger x WHERE x.kind = 'restore' AND x.source_id = l.source_id) AS restored
  FROM credit_ledger l
  LEFT JOIN appointments a ON l.source_kind = 'appointment' AND a.id = l.source_id AND a.deleted_at IS NULL
  LEFT JOIN referral_attributions r ON l.kind = 'grant' AND l.source_kind = 'referral' AND r.id = l.source_id
  WHERE l.person_id = ?1 AND l.visits <> 0
  ORDER BY l.created_at DESC, l.rowid DESC`;

/**
 * What a ledger entry was, as the client reads it: a credit spent on a visit it did not buy is lost, unless it came
 * back, as a charge of nothing or a disputed charge refunded gives it.
 */
function creditEventOf(row: CreditRow, noShow: NoShowNote | null): CreditEvent {
  if (row.kind === "grant") return "added";
  if (row.kind === "restore") return "returned";
  if (row.kind === "expire") return "expired";
  if (row.kind === "clawback") return "withdrawn";
  if (row.kind === "adjust") return "corrected";
  const lost = row.cancelled_late === 1 || noShow?.decision === "charged";
  return lost && row.restored === 0 ? "lost" : "used";
}

/** Every change to the person's credits, newest first (LIFE-14): the app lists them among the payments. */
export async function creditLines(db: D1Database, personId: string, now: Date) {
  const { results } = await db.prepare(CREDIT_QUERY).bind(personId).all<CreditRow>();
  const noShows = await noShowNotes(
    db,
    results.flatMap((row) => (row.appointment_id === null ? [] : [row.appointment_id])),
    now,
  );
  return results.map((row) => {
    const noShow = row.appointment_id === null ? null : (noShows.get(row.appointment_id) ?? null);
    return {
      id: row.id,
      date: indiaDate(new Date(row.created_at)),
      event: creditEventOf(row, noShow),
      visits: row.visits,
      visit: visitRefOf(row),
      source: row.kind === "grant" && row.source_kind !== "appointment" ? row.source_kind : null,
      referral_side: row.referral_side,
      no_show: noShow,
    };
  });
}

/** One of the person's entries, with its documents: a payment, or a refund; null when it is not theirs. */
export async function paymentEntry(db: D1Database, personId: string, id: string, now: Date) {
  const payment = await db.prepare(`${PAYMENT_QUERY} AND p.id = ?2`).bind(personId, id).first<PaymentRow>();
  if (payment !== null) {
    const invoice = payment.invoice_issued_at === null ? null : payment.appointment_id;
    const receipt = payment.books_payment_id === null ? null : payment.id;
    const notes = { noShows: await noShowsOf(db, [payment], now), codes: await codesOf(db, personId, payment.id) };
    return { ...paymentOf(payment, notes), documents: { invoice, receipt } };
  }
  const refund = await db.prepare(`${REFUND_QUERY} AND r.id = ?2`).bind(personId, id).first<RefundRow>();
  return refund === null ? null : { ...refundOf(refund), voucher: null };
}

/** Where a payment of the person's is in Books, once it is recorded there; null when it is not theirs. */
export function receiptOf(db: D1Database, personId: string, paymentId: string) {
  return db
    .prepare("SELECT books_payment_id FROM payments WHERE id = ?1 AND person_id = ?2 AND status != 'failed'")
    .bind(paymentId, personId)
    .first<{ books_payment_id: string | null }>();
}

/**
 * A visit of the person's tax invoice, once issued; null when the visit is not theirs. A raised invoice is still a
 * draft until the pass marks it sent, and a draft is not a document the client may open (ADR 0056).
 */
export async function issuedInvoiceOf(
  db: D1Database,
  personId: string,
  visitId: string,
): Promise<{ readonly invoiceId: string | null } | null> {
  const visit = await db
    .prepare(
      `SELECT fsm_invoice_id, invoice_issued_at FROM appointments
       WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL`,
    )
    .bind(visitId, personId)
    .first<{ fsm_invoice_id: string | null; invoice_issued_at: string | null }>();
  if (visit === null) return null;
  return { invoiceId: visit.invoice_issued_at === null ? null : visit.fsm_invoice_id };
}

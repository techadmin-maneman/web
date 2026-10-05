// A discount code on a hold (docs/decisions/0108-discount-codes.md): the client's, entered at the app's pay step
// before anything is paid, so Checkout's order is made for what is left; or the hold the site's form makes for a
// consultation and fit in one visit, whose product, and so its price, is chosen only at the visit, so what the code
// takes off waits for the payment link (src/domain/payment-links.ts). Uses are src/domain/discount-code-uses.ts.

import type { VisitType } from "../config/visit-types.ts";
import { amountOff, discounted, type DiscountTerms } from "../policy/discount-codes.ts";
import type { PaymentsProvider } from "../providers/payments/index.ts";
import { spendableCredits } from "./credits.ts";
import { termsOf } from "./discount-codes.ts";
import {
  checkDiscountCode,
  enteredAs,
  unpaidHold,
  useStatement,
  type Entered,
  type Refused,
  type Removed,
} from "./discount-code-uses.ts";
import type { Price } from "./price-book.ts";
import type { HoldState } from "./hold-stages.ts";

interface HoldRow {
  id: string;
  type: VisitType;
  amount_ex_gst: number;
  gst_percent: number;
  use_credit: number;
  moves_appointment_id: string | null;
  state: HoldState;
  confirmed_at: string | null;
  razorpay_order_id: string | null;
  expires_at: string;
}

async function clientHoldOf(db: D1Database, holdId: string, personId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT id, type, amount_ex_gst, gst_percent, use_credit, moves_appointment_id, state, confirmed_at,
              razorpay_order_id, expires_at
       FROM slot_holds WHERE id = ?1 AND person_id = ?2`,
    )
    .bind(holdId, personId)
    .first<HoldRow>();
}

/**
 * Why a hold's price can no longer change, or null while it can: while nothing is paid, and Checkout's order, where
 * there is one, has no payment on it that can still go through, as when the client closed Checkout without paying.
 */
async function holdClosed(
  hold: HoldRow,
  payments: PaymentsProvider,
  now: Date,
): Promise<Extract<Entered, { kind: "price_settled" | "expired" }> | null> {
  if (hold.state !== "held" || hold.confirmed_at !== null) return { kind: "price_settled" };
  if (hold.expires_at <= now.toISOString()) return { kind: "expired" };
  if (hold.razorpay_order_id !== null && !(await nothingPaidOn(payments, hold.razorpay_order_id))) {
    return { kind: "price_settled" };
  }
  return null;
}

/**
 * Whether no payment on the order can still go through: none was made, or each one failed. One still being made, or
 * an order Razorpay cannot be asked about, keeps the order and its price.
 */
async function nothingPaidOn(payments: PaymentsProvider, orderId: string): Promise<boolean> {
  try {
    const made = await payments.orderPayments(orderId);
    return made.every((payment) => payment.status === "failed");
  } catch {
    return false;
  }
}

/**
 * Lets the hold's Checkout order go, which nothing was paid on, so the next Pay makes one for the new price. It goes
 * first in the batch that changes the code, since a use is written only on a hold with no order.
 */
function dropOrder(db: D1Database, hold: HoldRow, now: Date): D1PreparedStatement[] {
  if (hold.razorpay_order_id === null) return [];
  return [
    db
      .prepare(
        `UPDATE slot_holds SET razorpay_order_id = NULL, updated_at = ?3
         WHERE id = ?1 AND razorpay_order_id = ?2 AND state = 'held' AND confirmed_at IS NULL`,
      )
      .bind(hold.id, hold.razorpay_order_id, now.toISOString()),
  ];
}

/** A hold's code: the use, the code's text and what it takes off. */
interface HoldCode {
  readonly useId: string;
  readonly code: string;
  /** Paise before GST; null on a one visit's hold, whose price is known only once the product is chosen. */
  readonly amountOff: number | null;
}

export async function codeOnHold(db: D1Database, holdId: string): Promise<HoldCode | null> {
  const row = await db
    .prepare(
      `SELECT u.id, c.code, u.amount_off FROM discount_code_uses u JOIN discount_codes c ON c.id = u.code_id
       WHERE u.hold_id = ?1 AND u.removed_at IS NULL`,
    )
    .bind(holdId)
    .first<{ id: string; code: string; amount_off: number | null }>();
  return row === null ? null : { useId: row.id, code: row.code, amountOff: row.amount_off };
}

/**
 * The client enters a code on their hold at the pay step: the hold is priced again, the code taken off before GST,
 * so Checkout's order is made for what is left. Only while nothing is paid: an order Checkout was closed on unpaid is
 * let go, and the next Pay makes one for the new price.
 */
export async function enterOnHold(
  db: D1Database,
  payments: PaymentsProvider,
  entry: { readonly holdId: string; readonly personId: string; readonly text: string },
  now: Date,
): Promise<Entered> {
  const hold = await clientHoldOf(db, entry.holdId, entry.personId);
  if (hold === null) return { kind: "not_found" };
  const closed = await holdClosed(hold, payments, now);
  if (closed !== null) return closed;
  if ((await codeOnHold(db, hold.id)) !== null) return { kind: "already_discounted" };

  const onCredit = await creditStillCovers(db, hold, entry.personId, now);
  const booking = { type: hold.type, onCredit, moves: hold.moves_appointment_id !== null };
  const checked = await checkDiscountCode(db, entry.text, booking, entry.personId, now);
  if (!checked.ok) return { kind: "not_applicable", reason: checked.reason };

  const off = amountOff(termsOf(checked.code), hold.amount_ex_gst);
  const price = discounted(hold, off);
  const use = {
    id: crypto.randomUUID(),
    codeId: checked.code.id,
    personId: entry.personId,
    holdId: hold.id,
    visitId: null,
    amountOff: off,
    by: { kind: "client", id: entry.personId },
  } as const;
  await db.batch([
    ...dropOrder(db, hold, now),
    useStatement(db, use, "unpaid_hold", now),
    db
      .prepare(
        `UPDATE slot_holds SET amount_ex_gst = ?2, amount = ?3, use_credit = 0, updated_at = ?4
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM discount_code_uses WHERE id = ?5)`,
      )
      .bind(hold.id, price.amount_ex_gst, price.amount, now.toISOString(), use.id),
  ]);
  return enteredAs(db, use.id, checked.code.code);
}

/** Whether a credit still pays for the hold: none does once another booking has taken the client's last one. */
async function creditStillCovers(db: D1Database, hold: HoldRow, personId: string, now: Date): Promise<boolean> {
  if (hold.use_credit !== 1) return false;
  return (await spendableCredits(db, personId, now, hold.id)).visits > 0;
}

/**
 * The client takes the code off their hold while nothing is paid: the hold is back at its price, and an order
 * Checkout was closed on unpaid is let go.
 */
export async function removeFromHold(
  db: D1Database,
  payments: PaymentsProvider,
  entry: { readonly holdId: string; readonly personId: string },
  now: Date,
): Promise<Removed> {
  const hold = await clientHoldOf(db, entry.holdId, entry.personId);
  if (hold === null) return "not_found";
  const closed = await holdClosed(hold, payments, now);
  if (closed !== null) return closed.kind;
  const code = await codeOnHold(db, hold.id);
  if (code === null) return "none";

  const at = now.toISOString();
  const listed = { amount_ex_gst: hold.amount_ex_gst + (code.amountOff ?? 0), gst_percent: hold.gst_percent };
  const restored = discounted(listed, 0);
  await db.batch([
    ...dropOrder(db, hold, now),
    db
      .prepare(
        `UPDATE discount_code_uses SET removed_at = ?2, removed_by = 'client', removed_by_id = ?3
         WHERE id = ?1 AND removed_at IS NULL AND ${unpaidHold("?4")}`,
      )
      .bind(code.useId, at, entry.personId, hold.id),
    db
      .prepare(
        `UPDATE slot_holds SET amount_ex_gst = ?2, amount = ?3, updated_at = ?4
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM discount_code_uses WHERE id = ?5 AND removed_at = ?4)`,
      )
      .bind(hold.id, restored.amount_ex_gst, restored.amount, at, code.useId),
  ]);
  return "removed";
}

/** What the app shows of a hold's code: the code, what it takes off, and the price before it. */
interface HoldDiscount {
  readonly code: string;
  /** Paise before GST; null while the price it comes off is not known. */
  readonly amount_ex_gst: number | null;
  readonly list_price: Price | null;
}

export async function holdDiscount(
  db: D1Database,
  hold: { readonly id: string; readonly price: Price },
): Promise<HoldDiscount | null> {
  const code = await codeOnHold(db, hold.id);
  if (code === null) return null;
  if (code.amountOff === null) return { code: code.code, amount_ex_gst: null, list_price: null };
  const listExGst = hold.price.amount_ex_gst + code.amountOff;
  return {
    code: code.code,
    amount_ex_gst: code.amountOff,
    list_price: discounted({ amount_ex_gst: listExGst, gst_percent: hold.price.gst_percent }, 0),
  };
}

/** A code that applies to a consultation and fit in one visit: its ID, its text and what it takes off. */
export interface OneVisitCode {
  readonly ok: true;
  readonly codeId: string;
  readonly code: string;
  readonly terms: DiscountTerms;
}

/**
 * A code checked for a consultation and fit in one visit: the code, or why not. One typed on /book is judged as it
 * stood at `typedAt`.
 */
export async function checkForOneVisit(
  db: D1Database,
  text: string,
  personId: string | null,
  now: Date,
  typedAt: Date = now,
): Promise<OneVisitCode | { readonly ok: false; readonly reason: Refused }> {
  const booking = { type: "first_fit", onCredit: false, moves: false } as const;
  // Someone new has used nothing, which no person's ID matches.
  const checked = await checkDiscountCode(db, text, booking, personId ?? "", now, typedAt);
  if (!checked.ok) return checked;
  return { ok: true, codeId: checked.code.id, code: checked.code.code, terms: termsOf(checked.code) };
}

/**
 * The use of a code entered on the site's form, for the hold the same batch makes: written only while the code still
 * has a use left for this client, and what it takes off waits for the payment link.
 */
export function useOnNewHold(
  db: D1Database,
  use: { readonly codeId: string; readonly personId: string; readonly holdId: string },
  now: Date,
): D1PreparedStatement {
  const newUse = {
    id: crypto.randomUUID(),
    codeId: use.codeId,
    personId: use.personId,
    holdId: use.holdId,
    visitId: null,
    amountOff: null,
    by: { kind: "client", id: use.personId },
  } as const;
  return useStatement(db, newUse, "new_hold", now);
}

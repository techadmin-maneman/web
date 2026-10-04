// What the client app says of the money of a consultation and fit in one visit: before the visit, what a hair system
// costs once fitted, after the visit's discount code; after it, the payment still owed and the link Razorpay texted.
//
// Before the visit, the code is the one on the visit, or on its hold while it is being booked, or, on a request ops
// have still to book, the one the client typed on /book, which ops honour as typed.

import { indiaDate } from "../lib/india-time.ts";
import { amountOff, discounted, type DiscountKind, type DiscountTerms } from "../policy/discount-codes.ts";
import { codeOnVisit } from "./discount-code-uses.ts";
import { termsOf } from "./discount-codes.ts";
import { hairSystemName } from "./payment-links.ts";
import type { Price } from "./price-book.ts";
import { offeredProducts } from "./services.ts";

/** What a one visit still to happen costs the client, and only if they go ahead. */
export interface OneVisitPrice {
  /**
   * In paise, GST included, after the visit's code: the least a hair system offered on the visit's day costs. Null
   * while none is priced.
   */
  readonly amount: number | null;
  /** The hair systems differ in price, so the amount is where they start. */
  readonly from: boolean;
  /** The discount code on the visit; null for none. */
  readonly code: string | null;
}

/** A discount code on a one visit: its terms, and what it took off once that is fixed. */
interface PricingCode {
  readonly code: string;
  readonly terms: DiscountTerms;
  /** Paise before GST; null until the visit's price is known. */
  readonly amountOff: number | null;
}

interface PricingCodeRow {
  code: string;
  kind: DiscountKind;
  value: number;
  cap: number | null;
  amount_off: number | null;
}

const pricingCodeOf = (row: PricingCodeRow | null): PricingCode | null =>
  row === null ? null : { code: row.code, terms: termsOf(row), amountOff: row.amount_off };

/** A hair system's price, GST included, with the code taken off before GST as the payment link will. */
function afterCode(price: Price, code: PricingCode | null): number {
  if (code === null) return price.amount;
  const off = code.amountOff ?? amountOff(code.terms, price.amount_ex_gst);
  return discounted(price, off).amount;
}

/** What a one visit costs once fitted, by the hair systems offered on its day (India's date) and its code. */
async function priceOn(db: D1Database, day: string, code: PricingCode | null): Promise<OneVisitPrice> {
  const products = await offeredProducts(db, day);
  const amounts = products.map((product) => afterCode(product.price, code));
  const least = amounts.length === 0 ? null : Math.min(...amounts);
  return { amount: least, from: amounts.some((amount) => amount !== least), code: code?.code ?? null };
}

/** A one visit booked, priced with the code on it. */
export async function oneVisitPrice(db: D1Database, visitId: string, day: string): Promise<OneVisitPrice> {
  return priceOn(db, day, await codeOnVisit(db, visitId));
}

/** A one visit being booked, priced with the code entered on its hold on /book. */
export async function heldOneVisitPrice(db: D1Database, holdId: string, day: string): Promise<OneVisitPrice> {
  const code = await db
    .prepare(
      `SELECT c.code, c.kind, c.value, c.cap, u.amount_off
       FROM discount_code_uses u JOIN discount_codes c ON c.id = u.code_id
       WHERE u.hold_id = ?1 AND u.removed_at IS NULL`,
    )
    .bind(holdId)
    .first<PricingCodeRow>();
  return priceOn(db, day, pricingCodeOf(code));
}

/** A one visit asked for on /book while self-serve booking is off, priced with the code typed there; null for none. */
export async function requestedOneVisitPrice(
  db: D1Database,
  day: string,
  typed: string | null,
): Promise<OneVisitPrice> {
  if (typed === null) return priceOn(db, day, null);
  const code = await db
    .prepare("SELECT code, kind, value, cap, NULL AS amount_off FROM discount_codes WHERE code = ?1")
    .bind(typed)
    .first<PricingCodeRow>();
  return priceOn(db, day, pricingCodeOf(code));
}

/** A one visit's payment the client still owes, once fitted. */
export interface OwedPayment {
  readonly visit_id: string;
  /** India's date of the visit. */
  readonly date: string;
  /** In paise, GST included, after any code: what the link asks for. */
  readonly amount: number;
  /** The hair system fitted: "Mane Man Natural hair system". */
  readonly product: string;
  /** The link Razorpay texted; null until it has made one. */
  readonly url: string | null;
}

interface OwedRow {
  appointment_id: string;
  window_start: string;
  amount: number;
  short_url: string | null;
  product: string | null;
}

/** The client's payment links not yet paid, the oldest first. */
export async function owedPayments(db: D1Database, personId: string): Promise<OwedPayment[]> {
  const { results } = await db
    .prepare(
      `SELECT l.appointment_id, a.window_start, l.amount, l.short_url, s.name AS product
       FROM appointments a JOIN payment_links l ON l.appointment_id = a.id
       LEFT JOIN services s ON s.kind = 'first_fit' AND s.tier = l.tier
       WHERE a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND l.paid_at IS NULL
       ORDER BY l.created_at`,
    )
    .bind(personId)
    .all<OwedRow>();
  return results.map((row) => ({
    visit_id: row.appointment_id,
    date: indiaDate(new Date(row.window_start)),
    amount: row.amount,
    product: hairSystemName(row.product ?? undefined),
    url: row.short_url,
  }));
}

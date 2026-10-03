// What the client app says of the money of a consultation and fit in one visit: before the visit, what a hair system
// costs once fitted, after the visit's discount code; after it, the payment still owed and the link Razorpay texted.

import { indiaDate } from "../lib/india-time.ts";
import { amountOff, discounted } from "../policy/discount-codes.ts";
import { codeOnVisit, type VisitCode } from "./discount-code-uses.ts";
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

/** A hair system's price, GST included, with the visit's code taken off before GST as its payment link will. */
function afterCode(price: Price, code: VisitCode | null): number {
  if (code === null) return price.amount;
  const off = code.amountOff ?? amountOff(code.terms, price.amount_ex_gst);
  return discounted(price, off).amount;
}

/** What the one visit costs once fitted, by the hair systems offered on its day (India's date) and its code. */
export async function oneVisitPrice(db: D1Database, visitId: string, day: string): Promise<OneVisitPrice> {
  const [products, code] = await Promise.all([offeredProducts(db, day), codeOnVisit(db, visitId)]);
  const amounts = products.map((product) => afterCode(product.price, code));
  const least = amounts.length === 0 ? null : Math.min(...amounts);
  return { amount: least, from: amounts.some((amount) => amount !== least), code: code?.code ?? null };
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

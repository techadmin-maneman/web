// A payment or a refund, and a change to the service-visit credits, as the payments screens write them (boards E1
// to E3).

import { fullDate, indiaClock, indiaDate, listDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { CreditLine, Entry } from "../api.ts";
import { payments, VISIT_TYPES } from "../content.ts";
import { priceFigures } from "../lib/money.ts";
import { visitName } from "../lib/visit.ts";

type PaymentEntry = Extract<Entry, { kind: "payment" }>;

/** The visit's kind, else the kind being booked while there is no visit yet, else only that it was a payment. */
function paidFor(entry: Entry): string {
  if (entry.visit !== null) return visitName(entry.visit.type);
  if (entry.booking !== null) return VISIT_TYPES[entry.booking.type];
  return payments.payment;
}

/** What it paid for, or its late fee. */
export function entryWhat(entry: Entry): string {
  const what = paidFor(entry);
  return entry.kind === "payment" && entry.purpose === "late_fee" ? payments.lateFeeOf(what) : what;
}

/** The row's name and the page's title: a refund is a refund, never another payment. */
export const entryTitle = (entry: Entry) => (entry.kind === "refund" ? payments.refund : entryWhat(entry));

/** A method as a list line writes it (short) or a detail row does (long): "card", "Card". */
export function methodName(method: string | null, form: "short" | "long"): string | null {
  if (method === null) return null;
  const names = payments.methods[method];
  return names === undefined ? method : names[form === "short" ? 0 : 1];
}

/**
 * The list's line under the name: "22 Aug · UPI"; for a refund what it gave back, "14 Sep · First fit"; and for a
 * visit the client was not home for, "19 Sep · not home, we waited 16 min" (LIFE-07).
 */
export function entryMeta(entry: Entry, thisYear: number): string {
  const date = listDate(entry.date, thisYear);
  if (entry.kind === "refund") return `${date} · ${entryWhat(entry)}`;
  if (entry.no_show !== null) return `${date} · ${payments.noShow.meta(entry.no_show)}`;
  const method = methodName(entry.method, "short");
  return method === null ? date : `${date} · ${method}`;
}

/** The main figure: what was paid, GST included, or for a refund the money coming back, "+ Rs. 30,000". */
export const entryAmount = (entry: Entry) =>
  entry.kind === "refund" ? payments.moneyBack(rupees(entry.amount)) : rupees(entry.amount);

/** The list's line beneath the figure: where a refund goes, "back to your UPI", or a payment's GST split. */
export function entryBeneath(entry: Entry): string | null {
  if (entry.kind === "payment") return priceFigures(entry).split;
  const method = methodName(entry.destination, "short");
  return method === null ? null : payments.backTo(method);
}

/** The code applied when it was paid, "WEDDNG25 · Rs. 200 off", or null. */
export function entryDiscount(entry: PaymentEntry): string | null {
  if (entry.discount === null) return null;
  return payments.discount(entry.discount.code, rupees(entry.discount.amount_off));
}

/** A charge's evidence: "cancelled 9:14 am, visit was 10 am", with the dates on different days. */
export function chargeEvidence(charge: NonNullable<Extract<Entry, { kind: "payment" }>["charge"]>): string {
  const sameDay = indiaDate(charge.at) === indiaDate(charge.visit_started_at);
  const when = (instant: string) =>
    sameDay ? indiaClock(instant) : `${shortDate(indiaDate(instant))}, ${indiaClock(instant)}`;
  return payments.evidence(charge.change, when(charge.at), when(charge.visit_started_at));
}

/**
 * "Paid", "Refund processing", "Charged"; on the entry's own page, with how long a refund takes. A visit the client
 * was not home for is charged once ops charge it, and otherwise paid, with where the ruling stands.
 */
export function entryStatus(entry: Entry, withSpeed = false): string {
  if (entry.kind === "payment" && entry.charge !== null && entry.status === "captured") return payments.charged;
  if (entry.kind === "payment" && entry.no_show !== null && entry.status === "captured") {
    return entry.no_show.decision === "charged"
      ? payments.charged
      : `${payments.status.captured} · ${payments.noShow.decision[entry.no_show.decision]}`;
  }
  const status = payments.status[entry.status];
  const speed =
    entry.kind === "refund" && entry.status === "created" && entry.speed !== null
      ? payments.speed[entry.speed]
      : undefined;
  return withSpeed && speed !== undefined ? `${status} · ${speed}` : status;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Days from one India date (YYYY-MM-DD) to another. */
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Razorpay's normal refund is 5 to 7 working days: ten days take in any weekend and holiday among them. */
const REFUND_DAYS = 10;

/** A refund still processing after its working days, which the client should hear is late. */
export function refundIsLate(entry: Entry, today: string): boolean {
  return entry.kind === "refund" && entry.status === "created" && daysFrom(entry.date, today) > REFUND_DAYS;
}

/**
 * What a payment's missing invoice says, by where its visit stands (content.ts, payments.unavailable): an
 * invoice is raised once the visit is done, is usually there within the hour, and a day on is late. A booking
 * still being made has no visit yet, so its invoice comes after the visit.
 */
export function missingInvoice(entry: PaymentEntry, today: string): "invoiceAfterVisit" | "invoice" | "invoiceLate" {
  if (entry.visit === null) return entry.booking?.under_way === true ? "invoiceAfterVisit" : "invoiceLate";
  const since = daysFrom(entry.visit.date, today);
  if (since < 0) return "invoiceAfterVisit";
  return since <= 1 ? "invoice" : "invoiceLate";
}

/**
 * Whether the visit's invoice will ever come for this payment. It will not for a charge or a visit the client was
 * not home for (the visit did not happen), a late fee (not the visit), a payment refunded in full, or a booking
 * refunded or let go before it became a visit.
 */
function invoiceComes(entry: PaymentEntry): boolean {
  if (entry.charge !== null || entry.no_show !== null) return false;
  if (entry.purpose === "late_fee") return false;
  if (entry.status === "refunded") return false;
  if (entry.visit === null && entry.booking !== null && !entry.booking.under_way) return false;
  return true;
}

/** A payment's documents: the visit's invoice, where one will come, and the receipt. */
export function documentsOf(entry: PaymentEntry): ("invoice" | "receipt")[] {
  return invoiceComes(entry) ? ["invoice", "receipt"] : ["receipt"];
}

/** A payment or refund, or a change to the credits, as one row of the Payments list. */
export type PaymentsRow =
  | { readonly kind: "entry"; readonly date: string; readonly entry: Entry }
  | { readonly kind: "credit"; readonly date: string; readonly line: CreditLine };

/**
 * The payments and the credits' changes as one list, newest first, as board E1 lists a visit a credit covered
 * among the payments. The sort keeps each list's own order, and on the same day a payment comes first.
 */
export function paymentsAndCredits(entries: readonly Entry[], credits: readonly CreditLine[]): PaymentsRow[] {
  const rows: PaymentsRow[] = [
    ...entries.map((entry) => ({ kind: "entry" as const, date: entry.date, entry })),
    ...credits.map((line) => ({ kind: "credit" as const, date: line.date, line })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** What a credit's row is about: the visit it paid for, or the credits themselves. */
export const creditWhat = (line: CreditLine) =>
  line.visit === null ? payments.credits.title : visitName(line.visit.type);

/** The list's line under the name: "25 Jul · visit credit", "19 Sep · a friend you invited was fitted". */
export function creditMeta(line: CreditLine, thisYear: number): string {
  const date = listDate(line.date, thisYear);
  if (line.no_show !== null) return `${date} · ${payments.noShow.meta(line.no_show)}`;
  if (line.event === "added") return `${date} · ${payments.credits.from[line.source ?? "ops"]}`;
  return `${date} · ${payments.credits.meta[line.event]}`;
}

export const creditStatus = (line: CreditLine) => payments.credits.status[line.event];

/** The figures a credit's row shows: Rs. 0 for a visit it covered, as board E1 does, and the credits it moved. */
export function creditAmount(line: CreditLine): { amount: string | null; count: string } {
  return {
    amount: line.visit === null ? null : rupees(0),
    count: payments.credits.count(line.event, Math.abs(line.visits)),
  };
}

/** What a WhatsApp asking for a document names: the reference, else the entry and its date. */
export function entryNamed(entry: Entry): string {
  if (entry.kind === "payment" && entry.reference !== null) return entry.reference;
  const what = entry.kind === "refund" ? payments.refundOf(entryWhat(entry)) : entryWhat(entry);
  return `${what.toLowerCase()} on ${fullDate(entry.date)}`;
}

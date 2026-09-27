// A payment or a refund, and a change to the service-visit credits, as the payments screens write them (boards E1
// to E3).

import { fullDate, indiaClock, indiaDate, listDate, shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { CreditLine, Entry } from "../api.ts";
import { payments } from "../content.ts";
import { visitName } from "../lib/visit.ts";

/** What it paid for: the visit's kind, or its late fee. */
export function entryWhat(entry: Entry): string {
  const what = entry.visit === null ? payments.payment : visitName(entry.visit.type);
  return entry.kind === "payment" && entry.purpose === "late_fee" ? payments.lateFeeOf(what) : what;
}

/** The page's title: a refund says so. */
export const entryTitle = (entry: Entry) =>
  entry.kind === "refund" ? payments.refundOf(entryWhat(entry)) : entryWhat(entry);

/** A method as a list line writes it (short) or a detail row does (long): "card", "Card". */
export function methodName(method: string | null, form: "short" | "long"): string | null {
  if (method === null) return null;
  const names = payments.methods[method];
  return names === undefined ? method : names[form === "short" ? 0 : 1];
}

/**
 * The list's line under the name: "22 Aug · UPI", "14 Sep · refund to UPI", and for a visit the client was not
 * home for, "19 Sep · not home, we waited 16 min" (LIFE-07).
 */
export function entryMeta(entry: Entry, thisYear: number): string {
  const date = listDate(entry.date, thisYear);
  if (entry.kind === "payment" && entry.no_show !== null) return `${date} · ${payments.noShow.meta(entry.no_show)}`;
  const method = methodName(entry.kind === "refund" ? entry.destination : entry.method, "short");
  if (method === null) return date;
  return `${date} · ${entry.kind === "refund" ? payments.refundTo(method) : method}`;
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
 * invoice is raised once the visit is done, is usually there within the hour, and a day on is late.
 */
export function missingInvoice(
  entry: Extract<Entry, { kind: "payment" }>,
  today: string,
): "invoiceAfterVisit" | "invoice" | "invoiceLate" {
  if (entry.visit === null) return "invoiceLate";
  const since = daysFrom(entry.visit.date, today);
  if (since < 0) return "invoiceAfterVisit";
  return since <= 1 ? "invoice" : "invoiceLate";
}

/**
 * A payment's documents: the visit's invoice and the receipt. A charge was kept for a visit that did not happen,
 * as was a payment for a visit the client was not home for, and a late fee is not the visit, so none of them has
 * the visit's invoice: only the receipt.
 */
export function documentsOf(entry: Extract<Entry, { kind: "payment" }>): ("invoice" | "receipt")[] {
  if (entry.charge !== null || entry.no_show !== null || entry.purpose === "late_fee") return ["receipt"];
  return ["invoice", "receipt"];
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
export const entryNamed = (entry: Entry) =>
  entry.kind === "payment" && entry.reference !== null
    ? entry.reference
    : `${entryTitle(entry).toLowerCase()} on ${fullDate(entry.date)}`;

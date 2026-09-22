// A payment or a refund, as the payments screens write it (boards E1 to E3).

import { fullDate, indiaClock, indiaDate, listDate, shortDate } from "@maneman/web-kit/dates";
import type { Entry } from "../api.ts";
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

/** The list's line under the name: "22 Aug · UPI", "14 Sep · refund to UPI". */
export function entryMeta(entry: Entry, thisYear: number): string {
  const date = listDate(entry.date, thisYear);
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

/** "Paid", "Refund processing", "Charged"; on the entry's own page, with how long a refund takes. */
export function entryStatus(entry: Entry, withSpeed = false): string {
  if (entry.kind === "payment" && entry.charge !== null && entry.status === "captured") return payments.charged;
  const status = payments.status[entry.status];
  const speed =
    entry.kind === "refund" && entry.status === "created" && entry.speed !== null
      ? payments.speed[entry.speed]
      : undefined;
  return withSpeed && speed !== undefined ? `${status} · ${speed}` : status;
}

/** What a WhatsApp asking for a document names: the reference, else the entry and its date. */
export const entryNamed = (entry: Entry) =>
  entry.kind === "payment" && entry.reference !== null
    ? entry.reference
    : `${entryTitle(entry).toLowerCase()} on ${fullDate(entry.date)}`;

// Discount codes (docs/decisions/0108-discount-codes.md). The owner asked on 1 October 2026 "to allow for discount
// codes to be generated and used before invoicing", and answered each question in turn; the rules below are those
// answers. Ops generate the codes in the console, and the client, the technician or ops enter one on a booking
// (src/domain/discount-codes.ts). The invoice then shows the price, the discount and the total
// (src/domain/fsm-invoices.ts).

import { withGst } from "../config/gst.ts";
import type { VisitType } from "../config/visit-types.ts";

export const RULES = [
  "% or rupees, per code: a percentage, with an optional rupee cap, or a fixed rupee amount, taken off before GST, so the invoice shows the discounted price.",
  "Ops choose per code what it covers: the first fit (the one-visit consultation and fit included), service visits, replacements, or any of them.",
  "Client, technician or ops enter it: the client where they pay or book, the technician before sending the pay-at-visit link, ops on a booking in the console; always before the invoice is made.",
  "Ops set limits per code: an expiry date, total uses (one, many or unlimited), once per client; one code per booking; never on a visit a referral credit pays for; ops can switch a code off at any time, and its uses stay on record.",
] as const;

export const DISCOUNT_KINDS = ["percent", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** The kinds of visit a code may cover (RULES[1]): never a consultation, which costs nothing. */
export const COVERABLE = ["first_fit", "service", "replacement"] as const satisfies readonly VisitType[];
export type Coverable = (typeof COVERABLE)[number];

/** What a code takes off: a whole percentage with an optional cap, or an amount; each in paise before GST. */
export interface DiscountTerms {
  readonly kind: DiscountKind;
  /** Per cent, 1 to 100, for a percentage; paise for an amount. */
  readonly value: number;
  /** The most a percentage takes off, in paise; null for none. */
  readonly cap: number | null;
}

/** The letters and digits a code is made of: none that reads as another, so no I, L, O, 0 or 1. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** How long a generated code is: 31 characters to the power of 8 is about 850 billion codes. */
export const GENERATED_LENGTH = 8;

/** How long a code ops type may be. */
export const CODE_LENGTH = { min: 4, max: 16 } as const;

const CODE_TEXT = new RegExp(`^[${CODE_ALPHABET}]{${String(CODE_LENGTH.min)},${String(CODE_LENGTH.max)}}$`);

/** A code as it is kept and compared (RULES[2]): in capitals, with no spaces around it. */
export const normalisedCode = (text: string): string => text.trim().toUpperCase();

/** Whether text, normalised, can be a code: four to sixteen of the alphabet's characters. */
export const isCodeText = (text: string): boolean => CODE_TEXT.test(normalisedCode(text));

/** What a code takes off a price before GST (RULES[0]): never more than the price, so never below zero. */
export function amountOff(terms: DiscountTerms, priceExGst: number): number {
  const off = terms.kind === "percent" ? percentOff(terms, priceExGst) : terms.value;
  return Math.min(off, priceExGst);
}

function percentOff(terms: DiscountTerms, priceExGst: number): number {
  const off = Math.round((priceExGst * terms.value) / 100);
  return terms.cap === null ? off : Math.min(off, terms.cap);
}

/** A price with the discount taken off before GST, and GST charged on what is left (RULES[0]). */
export function discounted(
  price: { readonly amount_ex_gst: number; readonly gst_percent: number },
  off: number,
): { amount_ex_gst: number; amount: number; gst_percent: number } {
  const exGst = Math.max(0, price.amount_ex_gst - off);
  return { amount_ex_gst: exGst, amount: withGst(exGst, price.gst_percent), gst_percent: price.gst_percent };
}

/** A code as it stands when it is entered: whether it is on, its limits, and how far they are used. */
export interface CodeState {
  readonly switchedOff: boolean;
  /** The last day in India it may be entered; null for no end. */
  readonly expiresOn: string | null;
  readonly covers: readonly Coverable[];
  /** Null for no limit. */
  readonly maxUses: number | null;
  /** The bookings it stands on now. */
  readonly uses: number;
  readonly oncePerClient: boolean;
  /** Whether it stands on a booking of this client's now. */
  readonly usedByClient: boolean;
}

/** The booking a code is entered on, as far as a code cares. */
export interface CodeBooking {
  readonly type: VisitType;
  /** A referral credit pays for it. */
  readonly onCredit: boolean;
  /** It moves a visit already booked, for free, for its late fee, or as a new visit in its place. */
  readonly moves: boolean;
}

/**
 * Why a code does not apply to a booking; null when it does. Whoever entered it is told only that it does not apply
 * (docs/decisions/0108-discount-codes.md); the reason is logged. A code is for a visit sold: a move is not one, so
 * neither its late fee nor the visit a late move books in its place takes a code (a default taken for the owner to confirm, ADR 0108).
 */
export type CodeRefusal = "switched_off" | "expired" | "not_covered" | "used_up" | "used_by_client" | "credit" | "move";

export function codeRefusal(code: CodeState, booking: CodeBooking, today: string): CodeRefusal | null {
  if (code.switchedOff) return "switched_off";
  if (code.expiresOn !== null && today > code.expiresOn) return "expired";
  if (!(code.covers as readonly VisitType[]).includes(booking.type)) return "not_covered";
  if (booking.onCredit) return "credit";
  if (booking.moves) return "move";
  if (code.maxUses !== null && code.uses >= code.maxUses) return "used_up";
  if (code.oncePerClient && code.usedByClient) return "used_by_client";
  return null;
}

/**
 * How often a code may be checked (docs/decisions/0108-discount-codes.md): a client's number ten times a day, and
 * one address thirty times an hour, every check counted, so a code cannot be found by guessing.
 */
export const CODE_CHECKS = { perNumberDaily: 10, perAddressHourly: 30 } as const;

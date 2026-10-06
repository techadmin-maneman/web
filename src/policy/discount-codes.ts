// Discount codes (docs/decisions/0108-discount-codes.md), generated and used before invoicing. Ops generate the codes
// in the console, and the client, the technician or ops enter one on a booking
// (src/domain/discount-codes.ts). The invoice then shows the price, the discount and the total
// (src/domain/books-invoices.ts).

import { withGst } from "../config/gst.ts";
import type { VisitType } from "../config/visit-types.ts";
import { takesCredit } from "./referral-reward.ts";

export const DISCOUNT_KINDS = ["percent", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** The kinds of visit a code may cover: never a consultation, which costs nothing. */
export const COVERABLE = ["first_fit", "service", "replacement"] as const satisfies readonly VisitType[];
export type Coverable = (typeof COVERABLE)[number];

/** What a code takes off: a whole percentage with an optional cap, or an amount; each in paise before GST. */
export interface DiscountTerms {
  readonly kind: DiscountKind;
  /** Per cent, 1 to 100, for a percentage; paise, in whole rupees, for an amount. */
  readonly value: number;
  /** The most a percentage takes off, in paise, in whole rupees; null for none. */
  readonly cap: number | null;
}

const PAISE_PER_RUPEE = 100;

const isWholeRupees = (paise: number): boolean => paise % PAISE_PER_RUPEE === 0;

/**
 * The term a code may not be made with, if any. Rupees are whole so that a whole-rupee price stays whole once the
 * code is taken off, and its GST splits into two equal halves, as Books works it out.
 */
export function termsRefusal(terms: DiscountTerms): "value" | "cap" | null {
  if (terms.kind === "percent" && terms.value > 100) return "value";
  if (terms.kind === "amount" && !isWholeRupees(terms.value)) return "value";
  if (terms.cap === null) return null;
  if (terms.kind === "amount" || !isWholeRupees(terms.cap)) return "cap";
  return null;
}

/** The letters and digits a code is made of: none that reads as another, so no I, L, O, 0 or 1. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** How long a generated code is: 31 characters to the power of 8 is about 850 billion codes. */
export const GENERATED_LENGTH = 8;

/** How long a code ops type may be. */
export const CODE_LENGTH = { min: 4, max: 16 } as const;

// A code ops type may use every letter and digit, I, L and O among them; only a generated one keeps to the alphabet
// above, since nobody chose its letters.
const CODE_TEXT = new RegExp(`^[A-Z0-9]{${String(CODE_LENGTH.min)},${String(CODE_LENGTH.max)}}$`);

/** A code as it is kept and compared: in capitals, with no spaces around it. */
export const normalisedCode = (text: string): string => text.trim().toUpperCase();

/** Whether text, normalised, can be a code ops type: four to sixteen letters and digits. */
export const isCodeText = (text: string): boolean => CODE_TEXT.test(normalisedCode(text));

/** What a code takes off a price before GST: never more than the price, so never below zero. */
export function amountOff(terms: DiscountTerms, priceExGst: number): number {
  const off = terms.kind === "percent" ? percentOff(terms, priceExGst) : terms.value;
  return Math.min(off, priceExGst);
}

/** A percentage of the price, to the nearest whole rupee. */
function percentOff(terms: DiscountTerms, priceExGst: number): number {
  const rupees = Math.round((priceExGst * terms.value) / (100 * PAISE_PER_RUPEE));
  const off = rupees * PAISE_PER_RUPEE;
  return terms.cap === null ? off : Math.min(off, terms.cap);
}

/** A price with the discount taken off before GST, and GST charged on what is left. */
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
  /** A referral credit pays for it, or one the client still holds could. */
  readonly onCredit: boolean;
  /** It moves a visit already booked, for free, for its late fee, or as a new visit in its place. */
  readonly moves: boolean;
}

/**
 * Why a code does not apply to a booking; null when it does. Whoever entered it is told only that it does not apply
 * (docs/decisions/0108-discount-codes.md); the reason is logged. A visit's code moves with it, but a move takes no
 * code of its own: neither its late fee nor the visit a late move books.
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
 * Whether a credit the client still holds would pay for a visit of this kind: one a credit can pay, a
 * service visit, while they hold one. The credit is spent first, so no code goes on it.
 */
export const creditComesFirst = (type: VisitType, creditsHeld: number): boolean =>
  takesCredit(type, null) && creditsHeld > 0;

/**
 * How often a code may be checked (docs/decisions/0108-discount-codes.md): a client's number ten times a day, and
 * one address thirty times an hour, every check counted, so a code cannot be found by guessing.
 */
export const CODE_CHECKS = { perNumberDaily: 10, perAddressHourly: 30 } as const;

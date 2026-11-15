// The client signs off a fit (docs/decisions/0254-client-signs-off-the-fit.md): which visits need it before they close
// done, and the three checks the client answers.

import type { VisitType } from "../config/visit-types.ts";

export const SIGN_OFF_STATES = ["asked", "signed", "flagged", "declined"] as const;
export type SignOffState = (typeof SIGN_OFF_STATES)[number];

/** What the client checks before they sign: the hairline, the colour and blend, and that it is secure and comfortable. */
export const SIGN_OFF_CHECKS = ["hairline", "blend", "secure"] as const;
export type SignOffCheck = (typeof SIGN_OFF_CHECKS)[number];

/** The longest a flag's words, and a decline's reason, may be. */
export const FLAG_MAX_CHARS = 500;
export const DECLINE_MAX_CHARS = 300;

/** Why a fit ops closed by hand as done, with no sign-off on record, reads as declined (src/domain/visits/hand-close.ts). */
export const CLOSED_BY_HAND = "Closed by hand in the console, with no sign-off on record";

/**
 * Whether a visit closed done needs the client's sign-off first: a first fit, a replacement, and a consultation and
 * fit in one visit that fitted the client today.
 */
export function needsSignOff(type: VisitType, oneVisit: { readonly fitsToday: boolean } | null): boolean {
  if (oneVisit !== null) return oneVisit.fitsToday;
  return type === "first_fit" || type === "replacement";
}

/** Whether a sign-off lets the fit close: the client signed, or the technician recorded why they would not. */
export const closesFit = (state: SignOffState | null): boolean => state === "signed" || state === "declined";

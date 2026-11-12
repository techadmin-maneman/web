// The client signs off a fit (docs/decisions/0254-client-signs-off-the-fit.md): which visits need it before they close
// done, the three checks the client answers, and how long a code to sign on the technician's phone lasts.

import type { VisitType } from "../config/visit-types.ts";
import { MINUTE_MS } from "../lib/durations.ts";

export const SIGN_OFF_STATES = ["asked", "signed", "flagged", "declined"] as const;
export type SignOffState = (typeof SIGN_OFF_STATES)[number];

/** What the client checks before they sign: the hairline, the colour and blend, and that it is secure and comfortable. */
export const SIGN_OFF_CHECKS = ["hairline", "blend", "secure"] as const;
export type SignOffCheck = (typeof SIGN_OFF_CHECKS)[number];

/** Where the client signed: in their own app, or on the technician's phone, with its one-time code. */
export const SIGNED_ON = ["client_app", "technician_phone"] as const;
export type SignedOn = (typeof SIGNED_ON)[number];

/** The longest a flag's words, and a decline's reason, may be. */
export const FLAG_MAX_CHARS = 500;
export const DECLINE_MAX_CHARS = 300;

/** How long the code to sign on the technician's phone lasts from the ask. */
export const PHONE_CODE_MS = 30 * MINUTE_MS;

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

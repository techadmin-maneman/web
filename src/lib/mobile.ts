// Indian mobile numbers, stored as E.164: "+919810000000". A number is read exactly as the site and the apps read
// it (@maneman/web-kit/mobile), so the number a visitor typed is the number the API keeps.

import { mobileDigits } from "@maneman/web-kit/mobile";

/**
 * What the API takes as a mobile number: ten digits starting 6 to 9, with +91, 91, 0091 or 0 in front or not, and
 * spaces or hyphens between them: "9810000000", "98100 00000", "+91 98100-00000", "098100 00000", "91-9810000000".
 */
export const INDIAN_MOBILE_PATTERN = /^(?:(?:\+|00?)?91|0)?[\s-]*[6-9](?:[\s-]*\d){9}$/;

/** The number as E.164, however it was written, by a visitor, by FSM or by Razorpay; null if it is not a mobile. */
export function toE164(input: string): string | null {
  const digits = mobileDigits(input);
  return digits === null ? null : `+91${digits}`;
}

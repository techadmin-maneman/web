// Indian mobile numbers as people type them: ten digits after a fixed +91, however they were typed, pasted or
// filled in by the phone. The site, the client app, the technician app and the API all read a number this one way.

/** +91, 91, 091, 0091 or 0 in front of ten digits, as a number copied from a contact or a message often is. */
const PREFIX = /^(?:0{0,2}91|0)(?=\d{10}$)/;

/**
 * One more than the longest number typed (ten digits behind "0091"), so a field never cuts a number back to a
 * valid one: a digit too many stays, and the number reads as wrong.
 */
const MOST_FIELD_DIGITS = 15;

/** The digits typed, with a country code or trunk prefix taken off the front of ten of them. */
export function typedDigits(typed: string): string {
  return typed.replace(/\D/g, "").replace(PREFIX, "");
}

/** The ten digits of an Indian mobile number, as typed with or without +91, 0 or spaces; null if it is not one. */
export function mobileDigits(typed: string): string | null {
  const digits = typedDigits(typed);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * What a mobile field keeps as it is typed. Nothing is cut at ten digits: "+91 98110 00000" typed key by key
 * passes through "91981100000" before its last digit takes the prefix off.
 */
export function fieldDigits(typed: string): string {
  return typedDigits(typed).slice(0, MOST_FIELD_DIGITS);
}

/** The field's digits as the site shows them: five, a space, then the rest ("98110 00000"). */
export function formatMobileField(typed: string): string {
  const digits = fieldDigits(typed);
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

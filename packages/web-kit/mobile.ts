// Indian mobile numbers as the apps take them: ten digits after a fixed +91,
// however they were typed, pasted or filled in by the phone. The client app and
// the technician app read a number this one way; the site still reads it its
// own way (site/src/lib/phone.ts, open point 95).

/** +91, 91, 091, 0091 or 0 in front of ten digits, as a number copied from a contact or a message often is. */
const PREFIX = /^(?:0{0,2}91|0)(?=\d{10}$)/;

/** The digits typed, with a country code or trunk prefix taken off the front of ten of them. */
export function typedDigits(typed: string): string {
  return typed.replace(/\D/g, "").replace(PREFIX, "");
}

/** The ten digits of an Indian mobile number, as typed with or without +91, 0 or spaces; null if it is not one. */
export function mobileDigits(typed: string): string | null {
  const digits = typedDigits(typed);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

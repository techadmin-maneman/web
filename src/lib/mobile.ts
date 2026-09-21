// Indian mobile numbers. The design collects ten digits after a fixed +91; we
// also accept the number typed with +91 or 0 in front, and with spaces or
// hyphens, and store it as E.164: "+919810000000".

/** "9810000000", "98100 00000", "+91 98100-00000", "098100 00000" */
export const INDIAN_MOBILE_PATTERN = /^(?:\+91|0)?[\s-]*[6-9](?:[\s-]*\d){9}$/;

export function toE164(input: string): string | null {
  const trimmed = input.trim();
  if (!INDIAN_MOBILE_PATTERN.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  return `+91${digits.slice(-10)}`;
}

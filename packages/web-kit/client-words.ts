// The words the site and the app share for the same moment, so a client who meets it on both reads it once.

/** A code that did not match, with the tries it has left: "That code didn’t match. 2 tries left." */
export function codeMismatch(left: number): string {
  if (left <= 0) return "That code didn’t match, and it no longer works.";
  return `That code didn’t match. ${String(left)} ${left === 1 ? "try" : "tries"} left.`;
}

export const CLIENT_WORDS = {
  /** A name the form refuses: empty, or not in letters. */
  nameError: "Enter your name.",
  mobilePlaceholder: "98100 00000",
  /** The address's first line. */
  addressLine: "Building, society or street",
  /** Beneath the address: what the technician needs to get in, and when they see it. */
  accessHint: "Gate code or parking. Your technician sees it the day before.",
  /** A write that did not go through, for a reason the client cannot act on. */
  failed: "That didn’t go through. Try again.",
} as const;

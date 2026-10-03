// Booking from the public site, /book and an invite's /r/:code, which asks for the full address before it books
// (ADR 0025, item 62; docs/decisions/0081-the-site-takes-the-address.md). The form needs no login, only a number,
// so whoever types a number must not be able to move where that person's visits go, or learn anything about them.
// src/domain/public-booking.ts applies it.
//
// The form books the consultation, or the consultation and the first fit in one visit, paid for at the visit
// (src/policy/one-visit.ts; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md). Nothing is paid on the site.

export const RULES = [
  "A booking from the site saves the address typed into it only when the person has no saved address. One they already have is kept, the visit goes to it, and its owner is told so on WhatsApp.",
  "The site gives every number the same answer. A number with a consultation still to happen, or past consultations, books nothing there: its owner is told why on WhatsApp.",
  "A visit goes to the address on the account, so that address's pincode is the one checked and booked. Where we do not come to it, nothing is booked, the page answers as it would for a new number, and its owner is told on WhatsApp.",
] as const;

/**
 * What a booking from the site does with the address typed into it: "saved", as the person's, when they have
 * none; "on_account" when they have one, which is kept and used, and the typed one is not written.
 */
export type TypedAddress = "saved" | "on_account";

export function typedAddress(person: { readonly hasSavedAddress: boolean }): TypedAddress {
  return person.hasSavedAddress ? "on_account" : "saved";
}

/** Why the site books nothing for a number we know, which its owner is told on WhatsApp. */
export type NotBookedFromSite = "consultation_exists" | "book_in_app" | "address_not_served";

/** Null when the person may book a consultation from the site, as anyone may. */
export function notBookedFromSite(person: {
  readonly hasConsultationToCome: boolean;
  readonly mayBookConsultation: boolean;
  /** Whether the address on their account is in a pincode we do not come to; false when they have none. */
  readonly addressOutsideArea: boolean;
}): NotBookedFromSite | null {
  if (person.hasConsultationToCome) return "consultation_exists";
  if (!person.mayBookConsultation) return "book_in_app";
  if (person.addressOutsideArea) return "address_not_served";
  return null;
}

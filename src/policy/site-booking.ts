// Booking from the public site, /book and an invite's /r/:code, which asks for the full address before it books
// (ADR 0025, item 62; docs/decisions/0081-the-site-takes-the-address.md). The form needs no login, only a number,
// so whoever types a number must not be able to move where that person's visits go. src/domain/public-booking.ts
// applies it.

export const RULES = [
  "A booking from the site saves the address typed into it only when the person has no saved address. One they already have is kept, and the visit goes to it.",
] as const;

/**
 * What a booking from the site does with the address typed into it: "saved", as the person's, when they have
 * none; "on_account" when they have one, which is kept and used, and the typed one is not written.
 */
export type TypedAddress = "saved" | "on_account";

export function typedAddress(person: { readonly hasSavedAddress: boolean }): TypedAddress {
  return person.hasSavedAddress ? "on_account" : "saved";
}

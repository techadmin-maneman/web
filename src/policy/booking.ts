// Booking a visit in the app: the owner's rulings of 27 September 2026, after trying the app on staging, in the
// owner's words as ADR 0025 records them (items 60 and 61). A slot is held (src/routes/client/booking.ts) only once
// the client has given the address the visit goes to (docs/decisions/0079-an-address-before-a-slot.md), and a
// booking, once confirmed, agrees to the photograph purposes its pay step showed that the client has never decided on
// (docs/decisions/0080-consents-given-by-booking.md), recorded by src/domain/booking-consents.ts.

import type { ConsentPurpose } from "./consents.ts";

export const RULES = [
  "A client gives their full address before a slot is confirmed.",
  "Booking a visit in the app agrees to photographs for the client's own record and on referral cards, each only while the client has never decided on it.",
] as const;

/** The parts an address is not one without, as the app's address form asks for them. */
interface AddressParts {
  readonly line1: string;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
}

/** Whether an address is whole enough to send a technician to: the building or street, the area, the city and a pincode. */
export function isFullAddress(address: AddressParts | null): address is AddressParts {
  if (address === null) return false;
  const filledIn = [address.line1, address.locality, address.city].every((part) => part.trim() !== "");
  return filledIn && /^\d{6}$/.test(address.pincode);
}

/** The two purposes a booking may agree to. */
export const GIVEN_BY_BOOKING = [
  "photos_own_record",
  "photos_referral_cards",
] as const satisfies readonly ConsentPurpose[];
export type GivenByBooking = (typeof GIVEN_BY_BOOKING)[number];

/**
 * What a booking agrees to: of the purposes the pay step showed, those a booking may agree to that the client has
 * never decided on. One they have switched, either way, stays as they left it.
 */
export function agreedByBooking(
  shown: readonly ConsentPurpose[],
  decided: readonly ConsentPurpose[],
): GivenByBooking[] {
  return GIVEN_BY_BOOKING.filter((purpose) => shown.includes(purpose) && !decided.includes(purpose));
}

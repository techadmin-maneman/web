// What a booking page's forms come back with, which the confirmation draws (./Done.tsx).

import type { Consultation, NotBooked, ReferralConsultation, ReferralWaitlist } from "../../lib/api.ts";

/** What a booking booked, or asked of ops. */
export type Answered = ReferralConsultation | Consultation;

/**
 * A booking's answer, with the number the visitor typed and the discount code they sent: the answer carries neither.
 * Only the site's own page sends a code, and only its answer says whether it stands. A number we know may have had
 * nothing booked, and the answer says why.
 */
export interface Booking {
  readonly result: Answered | NotBooked;
  readonly mobile: string;
  /** As it was sent; null for none. */
  readonly code: string | null;
}

/**
 * The waitlist's answer, the landing's or /book's: /book's carries the invite this browser remembered, if any. With it,
 * the pincode the person gave and whether they asked to be told when we come, which alone earns a promise of a message.
 */
export type Listing = Pick<ReferralWaitlist, "area" | "credits" | "invite"> & {
  readonly pincode: string;
  readonly alerted: boolean;
};

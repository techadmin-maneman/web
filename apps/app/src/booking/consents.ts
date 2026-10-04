// The photograph consents booking a visit also gives (docs/decisions/0080-consents-given-by-booking.md): which
// the pay step asks for, and the lines it shows. Once the booking is confirmed, the API records each the client has
// never decided on, on the notice holding exactly these lines (src/config/notices.ts), which
// test/node/dom/app-consent-lines.test.ts holds them to.

import type { BookingConsent, Profile } from "../api.ts";
import { booking, profile } from "../content.ts";

const ASKED_BY_BOOKING = ["photos_own_record", "photos_referral_cards"] as const satisfies readonly BookingConsent[];

/** The purposes the pay step asks for: those of the two the client has never switched, either way. */
export const undecidedOf = (client: Profile): BookingConsent[] =>
  ASKED_BY_BOOKING.filter((purpose) =>
    client.consents.some((consent) => consent.purpose === purpose && consent.since === null),
  );

/**
 * The pay step's lines for the purposes asked: what booking also agrees to, the referral card's own lines where
 * cards are asked, and that either can be switched off in Profile. None when nothing is asked.
 */
export function consentLines(asked: readonly BookingConsent[]): string[] {
  const copy = booking.pay.consents;
  const [only, ...others] = asked;
  if (only === undefined) return [];
  if (others.length > 0) return [copy.both, ...profile.referralCards.lines, copy.switchEither];
  const cardLines = only === "photos_referral_cards" ? profile.referralCards.lines : [];
  return [copy.alone[only], ...cardLines, copy.switchIt];
}

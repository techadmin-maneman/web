// The consent notices, word for word from the design (Mane Man Site v2). A
// consent row records which version the person saw, so a published version is
// never edited: change the wording by adding a new version and pointing
// CURRENT_NOTICE at it. test/worker/notices.test.ts fails if a published text
// changes.

import type { ConsentPurpose } from "../policy/consents.ts";

/** Phase 1's agreements, given on the public site, and Phase 2's consents, switched in the client app. */
export type NoticePurpose = "contact" | "tryon_photo" | "result_delivery" | ConsentPurpose;

export interface Notice {
  readonly version: string;
  readonly purpose: NoticePurpose;
  /** Every line of text shown with the agreement, in order. */
  readonly text: readonly string[];
}

/** The line a referrer reads before their invite names them (ADR 0025, item 24). */
const NAMING_LINE = "Your first name appears on your invite.";

/**
 * The pay step's lines, when booking a visit in the app also agrees to the photograph purposes the client has never
 * decided on (ADR 0080): for both, or for one asked alone. The app shows them word for word
 * (apps/app/src/booking/consents.ts; test/node/app-consent-lines.test.ts).
 */
const BOOKING_BOTH = [
  "By booking this visit, you also agree to photographs for your own record and on referral cards.",
  "Anyone you send this card to can see your photographs.",
  "They can forward it, and so can anyone who receives it.",
  "You can switch it off at any time, and new opens will show our house example instead.",
  "Cards already delivered stay in people’s chats. We cannot take those back.",
  NAMING_LINE,
  "You can switch either off in Profile.",
];
const BOOKING_OWN_RECORD = [
  "By booking this visit, you also agree to photographs for your own record.",
  "You can switch it off in Profile.",
];
const BOOKING_REFERRAL_CARDS = [
  "By booking this visit, you also agree to photographs on referral cards.",
  "Anyone you send this card to can see your photographs.",
  "They can forward it, and so can anyone who receives it.",
  "You can switch it off at any time, and new opens will show our house example instead.",
  "Cards already delivered stay in people’s chats. We cannot take those back.",
  NAMING_LINE,
  "You can switch it off in Profile.",
];

export const NOTICES: readonly Notice[] = [
  {
    // The booking form's consent checkbox.
    version: "booking-v1",
    purpose: "contact",
    text: ["I agree to be contacted about this visit. I have read how my details are used."],
  },
  {
    // The try-on consent screen, before the photograph is taken.
    version: "photo-v1",
    purpose: "tryon_photo",
    text: [
      "What happens to your photograph.",
      "Used for: Generating your simulation. Nothing else.",
      "Kept for: Thirty days, then deleted automatically.",
      "Training: Never used to train any model.",
      "Shared with: Nobody outside Mane Man.",
      "To withdraw: Message us and it is deleted the same day.",
      "I understand, and I agree to my photograph being used this way.",
    ],
  },
  {
    // The gate that asks where to send the result.
    version: "gate-v1",
    purpose: "result_delivery",
    text: [
      "The full-size image is on the next screen. We also send a copy to your WhatsApp so it is not lost when you close the browser.",
      "Where should we send it?",
      "The result opens on the next screen either way. The number is so we can send you a copy.",
      "No password, no account, no marketing. Your photograph is deleted after thirty days.",
    ],
  },
  // A client's try-on is kept, by the owner's ruling of 27 September 2026 (ADR 0025, item 65; ADR 0084).
  // PLACEHOLDER: the words await counsel (docs/open-points.md, item 146). Staging records them; if counsel changes
  // them, the new words are photo-v3 and gate-v3.
  {
    version: "photo-v2",
    purpose: "tryon_photo",
    text: [
      "What happens to your photograph.",
      "Used for: Generating your simulation. If you book a visit, a small copy is also kept in your Mane Man account as your before photo.",
      "Kept for: Thirty days at most, then deleted automatically. If you book a visit while your simulation is kept, we keep the small copy until you ask us to delete it, and the simulation until the photographs of your first fit are taken.",
      "Training: Never used to train any model.",
      "Shared with: Nobody outside Mane Man.",
      "To withdraw: Message us and it is deleted the same day.",
      "I understand, and I agree to my photograph being used this way.",
    ],
  },
  {
    version: "gate-v2",
    purpose: "result_delivery",
    text: [
      "The full-size image is on the next screen. We also send a copy to your WhatsApp so it is not lost when you close the browser.",
      "Where should we send it?",
      "The result opens on the next screen either way. The number is so we can send you a copy.",
      "No password, no account, no marketing. Your photograph is deleted after thirty days, unless you book a visit: then a small copy stays in your Mane Man account as your before photo, and the simulation until your first fit is photographed.",
    ],
  },
  // The look goes to WhatsApp only, by the owner's ruling of 1 October 2026 (ADR 0104): v2's words with the
  // promise of a result on screen taken out. Every build of the site shows these.
  // PLACEHOLDER: the words await counsel (docs/open-points.md, item 146); words counsel changes become v4.
  {
    version: "photo-v3",
    purpose: "tryon_photo",
    text: [
      "What happens to your photograph.",
      "Used for: Generating your simulation, which is sent to your WhatsApp and never shown on this site. If you book a visit, a small copy is also kept in your Mane Man account as your before photo.",
      "Kept for: Thirty days at most, then deleted automatically. If you book a visit while your simulation is kept, we keep the small copy until you ask us to delete it, and the simulation until the photographs of your first fit are taken.",
      "Training: Never used to train any model.",
      "Shared with: Nobody outside Mane Man.",
      "To withdraw: Message us and it is deleted the same day.",
      "I understand, and I agree to my photograph being used this way.",
    ],
  },
  {
    version: "gate-v3",
    purpose: "result_delivery",
    text: [
      "Your simulation is sent to your WhatsApp, and only there: for your privacy, it is never shown on this site.",
      "Where should we send it?",
      "We make your simulation once we have your number, and send it there on WhatsApp.",
      "No password, no account, no marketing. Your photograph is deleted after thirty days, unless you book a visit: then a small copy stays in your Mane Man account as your before photo, and the simulation until your first fit is photographed.",
    ],
  },
  // Phase 2's five consents (docs/prompts/phase2-backend.md, "Consents"), as the client app's profile names
  // them (design/phase2/Client App, G1). Counsel's sign-off is outstanding (plan input 6).
  {
    version: "photos-own-record-v1",
    purpose: "photos_own_record",
    text: ["Photographs for your own record"],
  },
  {
    // With the four lines the design shows before a client turns their card on (Client App, F3).
    version: "photos-referral-cards-v1",
    purpose: "photos_referral_cards",
    text: [
      "Photographs on referral cards",
      "Anyone you send this card to can see your photographs.",
      "They can forward it, and so can anyone who receives it.",
      "You can switch it off at any time, and new opens will show our house example instead.",
      "Cards already delivered stay in people’s chats. We cannot take those back.",
    ],
  },
  {
    // The four lines, and the naming line the owner ruled beside them (ADR 0025, item 24).
    version: "photos-referral-cards-v2",
    purpose: "photos_referral_cards",
    text: [
      "Photographs on referral cards",
      "Anyone you send this card to can see your photographs.",
      "They can forward it, and so can anyone who receives it.",
      "You can switch it off at any time, and new opens will show our house example instead.",
      "Cards already delivered stay in people’s chats. We cannot take those back.",
      "Your first name appears on your invite.",
    ],
  },
  // Given by booking a visit in the app (ADR 0080): each purpose's notice is every line the pay step showed.
  { version: "photos-own-record-booking-v1", purpose: "photos_own_record", text: BOOKING_BOTH },
  { version: "photos-referral-cards-booking-v1", purpose: "photos_referral_cards", text: BOOKING_BOTH },
  { version: "photos-own-record-booking-alone-v1", purpose: "photos_own_record", text: BOOKING_OWN_RECORD },
  {
    version: "photos-referral-cards-booking-alone-v1",
    purpose: "photos_referral_cards",
    text: BOOKING_REFERRAL_CARDS,
  },
  {
    version: "photos-marketing-v1",
    purpose: "photos_marketing",
    text: ["Photographs in our marketing"],
  },
  {
    version: "whatsapp-visits-v1",
    purpose: "whatsapp_visits",
    text: ["WhatsApp about your visits"],
  },
  {
    // As the waitlist asks it (design/phase2/Referral and Waitlist).
    version: "whatsapp-launches-v1",
    purpose: "whatsapp_launches",
    text: ["Tell me when you launch in my area."],
  },
  // The referral landing's own lines (design/phase2/Referral and Waitlist, C2 and C3; ADR 0048).
  {
    version: "referral-consultation-v1",
    purpose: "whatsapp_visits",
    text: ["You may contact me on WhatsApp about this consultation."],
  },
  {
    version: "waitlist-v1",
    purpose: "contact",
    text: ["You may contact me about this request."],
  },
];

/** The lines the referral landing shows, by what they are given for. */
export const LANDING_NOTICES = { consultation: "referral-consultation-v1", waitlist: "waitlist-v1" } as const;

/**
 * The line beside an invite that tells the friend their referrer hears of their fit, by the page that shows it: the
 * invite's own page, or /book with the invite this browser remembers. An attribution records the one the friend saw,
 * so new words take a new version (test/node/site-referral-reward.test.ts holds each version's words).
 */
export const TOLD_NOTICES = { landing: "invite-told-landing-v1", book: "invite-told-book-v1" } as const;
export type ToldNotice = (typeof TOLD_NOTICES)[keyof typeof TOLD_NOTICES];

/**
 * The version shown today for each purpose. The try-on's two are the only ones it records: every earlier version
 * promised the result on screen, which the site no longer shows (ADR 0104).
 */
export const CURRENT_NOTICE: Readonly<Record<NoticePurpose, string>> = {
  contact: "booking-v1",
  tryon_photo: "photo-v3",
  result_delivery: "gate-v3",
  photos_own_record: "photos-own-record-v1",
  photos_referral_cards: "photos-referral-cards-v2",
  photos_marketing: "photos-marketing-v1",
  whatsapp_visits: "whatsapp-visits-v1",
  whatsapp_launches: "whatsapp-launches-v1",
};

/**
 * The notices a consent given by booking is recorded under (ADR 0080), by whether the pay step asked for both
 * photograph purposes or for one alone. The profile's switch goes on recording CURRENT_NOTICE.
 */
export const BOOKING_NOTICES = {
  both: {
    photos_own_record: "photos-own-record-booking-v1",
    photos_referral_cards: "photos-referral-cards-booking-v1",
  },
  alone: {
    photos_own_record: "photos-own-record-booking-alone-v1",
    photos_referral_cards: "photos-referral-cards-booking-alone-v1",
  },
} as const;

/** Every notice for referral cards that carries the naming line: an invite names its referrer only on one of these. */
export const NAMING_NOTICES: readonly string[] = NOTICES.filter(
  (notice) => notice.purpose === "photos_referral_cards" && notice.text.includes(NAMING_LINE),
).map((notice) => notice.version);

export function findNotice(version: string): Notice | undefined {
  return NOTICES.find((notice) => notice.version === version);
}

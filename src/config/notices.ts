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

/** The version shown today for each purpose. */
export const CURRENT_NOTICE: Readonly<Record<NoticePurpose, string>> = {
  contact: "booking-v1",
  tryon_photo: "photo-v1",
  result_delivery: "gate-v1",
  photos_own_record: "photos-own-record-v1",
  photos_referral_cards: "photos-referral-cards-v2",
  photos_marketing: "photos-marketing-v1",
  whatsapp_visits: "whatsapp-visits-v1",
  whatsapp_launches: "whatsapp-launches-v1",
};

export function findNotice(version: string): Notice | undefined {
  return NOTICES.find((notice) => notice.version === version);
}

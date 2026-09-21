// The consent notices, word for word from the design (Mane Man Site v2). A
// consent row records which version the person saw, so a published version is
// never edited: change the wording by adding a new version and pointing
// CURRENT_NOTICE at it. test/worker/notices.test.ts fails if a published text
// changes.

export type NoticePurpose = "contact" | "tryon_photo" | "result_delivery";

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
];

/** The version shown today for each purpose. */
export const CURRENT_NOTICE: Readonly<Record<NoticePurpose, string>> = {
  contact: "booking-v1",
  tryon_photo: "photo-v1",
  result_delivery: "gate-v1",
};

export function findNotice(version: string): Notice | undefined {
  return NOTICES.find((notice) => notice.version === version);
}

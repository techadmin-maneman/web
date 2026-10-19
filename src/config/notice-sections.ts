// The site's /notices page: the full notice each one-line consent links to, a section each (ADR 0219), and the
// one-line notice that records its line with its section's words (src/config/notices.ts).

import type { NoticePurpose } from "./notices.ts";

/** The line a referrer reads before their invite names them (ADR 0025, item 24). */
export const NAMING_LINE = "Your first name appears on your invite.";

/** The line a screen shows, the words in it that link to its section (none: a link of its own after it), and where. */
export interface OneLine {
  readonly says: string;
  readonly link: string | null;
  readonly section: NoticeSection;
}

/**
 * The site's /notices page: the full notice each one-line consent links to, a section for each. A line records its
 * section's words with it, so new words for a section take new versions of the lines that link to it.
 * PLACEHOLDER: awaits counsel with the notices.
 */
export const NOTICE_SECTIONS = {
  "try-on": {
    heading: "The try-on",
    rows: [
      {
        label: "Used for",
        says: "Making your look, which we send to the WhatsApp number you give and show here once it’s ready. If you book a visit, a small copy of your photo is kept in your Mane Man account as your before photo.",
      },
      {
        label: "Kept for",
        says: "An hour, then deleted automatically. The small copy stays with your look for 14 days at most. If you book a visit in that time, we keep it until you ask us to delete it, and the look until the photos of your first fit are taken.",
      },
      { label: "Training", says: "Never used to train any model." },
      {
        label: "Shared with",
        says: "YouCam (Perfect Corp), which makes the look and keeps its copy of your photo for 30 days, and WhatsApp, which delivers it.",
      },
      { label: "Marketing", says: "None. No password and no account either." },
      { label: "To withdraw", says: "Message us and it is deleted the same day." },
    ],
  },
  photos: {
    heading: "Your photos",
    rows: [
      {
        label: "Visit photos",
        says: "Five angles at every visit, for your record. Only you and your technician see them.",
      },
      {
        label: "Referral cards",
        says: "Your before and after, on the card a friend sees when you send your invite. Anyone you send it to can see your photos, and can forward the card.",
      },
      {
        label: "Switching off",
        says: "Switch cards off in Profile at any time: new opens then show our example card. Cards already delivered stay in people’s chats.",
      },
      { label: "Your name", says: NAMING_LINE },
    ],
  },
  whatsapp: {
    heading: "WhatsApp",
    rows: [
      { label: "Visit updates", says: "Your booking confirmation, reminders and any change to a visit." },
      { label: "Launch alerts", says: "One message when we start coming to your area." },
      { label: "Requests", says: "We may contact you about a request you send us." },
      { label: "To stop", says: "Reply STOP to any message, or switch it off in Profile." },
    ],
  },
} as const satisfies Readonly<
  Record<
    string,
    { readonly heading: string; readonly rows: readonly { readonly label: string; readonly says: string }[] }
  >
>;
export type NoticeSection = keyof typeof NOTICE_SECTIONS;

/** A one-line notice, its text the line and then its section's rows as "label: what it says". */
export function oneLine<V extends string>(version: V, purpose: NoticePurpose, line: OneLine) {
  const rows = NOTICE_SECTIONS[line.section].rows.map((row) => `${row.label}: ${row.says}`);
  return { version, purpose, line, text: [line.says, ...rows] };
}

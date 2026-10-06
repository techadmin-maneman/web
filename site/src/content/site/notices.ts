// The notices a consent is given under, as the backend records them, and which are approved.

import { CURRENT_NOTICE, findNotice, LANDING_NOTICES } from "../../../../src/config/notices.ts";
import { KEEPING_NOTICES } from "../../../../src/policy/kept-try-ons.ts";

export interface Notice {
  readonly version: string;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly lines: readonly string[];
}

/**
 * The versions approved word for word: the try-on's three, and the consents, the landing's among them, by counsel
 * (ADR 0025, item 25).
 */
const APPROVED_NOTICES: readonly string[] = [
  "photo-v1",
  "gate-v1",
  "referral-consultation-v1",
  "waitlist-v1",
  "whatsapp-launches-v1",
];

function notice(version: string): Notice {
  const found = findNotice(version);
  if (found === undefined) throw new Error(`no notice ${version} in src/config/notices.ts`);
  return { version, approved: APPROVED_NOTICES.includes(version), lines: found.text };
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Every notice the site shows, which the production build refuses unless each is approved. The try-on's two say its
 * look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), and every build shows them,
 * so production's build waits for counsel to approve them (docs/open-points.md, item 146).
 */
export const notices = {
  /** The try-on consent screen. */
  photo: notice(CURRENT_NOTICE.tryon_photo),
  /** The try-on gate. */
  gate: notice(CURRENT_NOTICE.result_delivery),
  /** The booking form's agreement, on /book and /r/:code. */
  consultation: notice(LANDING_NOTICES.consultation),
  /** The waitlist's required agreement. */
  waitlist: notice(LANDING_NOTICES.waitlist),
  /** The waitlist's optional launch alert. */
  launchAlert: notice(CURRENT_NOTICE.whatsapp_launches),
} as const;

/**
 * The site sends the photograph's small copy only under a photo notice that says a client keeps it
 * (docs/decisions/0084-a-clients-try-on-is-kept.md).
 */
export const tryOnSendsCopy = KEEPING_NOTICES.includes(notices.photo.version);

// ---------------------------------------------------------------------------
// Placeholder blocks
// ---------------------------------------------------------------------------

// The notices a consent is given under, as the backend records them, and which are approved.

import {
  CURRENT_NOTICE,
  findNotice,
  LANDING_NOTICES,
  NOTICE_SECTIONS,
  type NoticeLayout,
  type NoticeSection,
} from "@rules/config/notices.ts";
import { KEEPING_NOTICES } from "@rules/policy/kept-try-ons.ts";

/** The site's page of full notices, which each one-line consent links to (ADR 0219). */
export const NOTICES_PATH = "/notices";

/** The full notices, a section each, as /notices shows them. */
export const noticeSections = NOTICE_SECTIONS;

/** A one-line consent as a screen draws it: its words, the words in it that link, and where they go. */
export interface NoticeWords {
  readonly says: string;
  readonly link: string | null;
  readonly href: string;
}

export const noticeHref = (section: NoticeSection): string => `${NOTICES_PATH}#${section}`;

export interface Notice {
  readonly version: string;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly lines: readonly string[];
  /** Its parts, where a screen lays them out. */
  readonly layout?: NoticeLayout;
  /** A one-line notice's line. */
  readonly line?: NoticeWords;
}

/**
 * The versions approved word for word: the try-on's three, and the consents, the landing's among them, by counsel
 * (ADR 0025).
 */
const APPROVED_NOTICES: readonly string[] = [
  "photo-v1",
  "gate-v1",
  "referral-consultation-v1",
  "waitlist-v1",
  "whatsapp-launches-v1",
  "photo-v7",
  "gate-v7",
  "referral-consultation-v2",
];

function notice(version: string): Notice {
  const found = findNotice(version);
  if (found === undefined) throw new Error(`no notice ${version} in src/config/notices.ts`);
  const approved = APPROVED_NOTICES.includes(version);
  const { line: one } = found;
  const line = one === undefined ? {} : { line: { says: one.says, link: one.link, href: noticeHref(one.section) } };
  return { version, approved, lines: found.text, ...("layout" in found ? { layout: found.layout } : {}), ...line };
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Every notice the site shows, which the production build refuses unless each is approved. The try-on's two say its
 * look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), and every build shows them,
 * so production's build waits for counsel to approve them.
 */
export const notices = {
  /** The try-on's photo, agreed to by using it. */
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

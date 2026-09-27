// How long an invite lasts (docs/prompts/phase2-backend.md, "Business rules, decided").
// The rules as the prompt states them, and the owner's ruling (ADR 0025, item 24). A lapsed invite is marked
// when its friend books (src/domain/referrals.ts), and again when their first fit is settled
// (src/domain/referral-grants.ts).

import { DAY_MS } from "../lib/durations.ts";

export const RULES = [
  "An invite to an unserved area stays valid config INVITE_TTL_AFTER_LAUNCH_DAYS (365) after that area goes live.",
  "An expired invite still allows a free consultation, but carries no credits.",
] as const;

/** How long an invite to an unserved area lasts once the area launches: 12 months, as ruled. */
export const INVITE_TTL_AFTER_LAUNCH_DAYS = 365;

/** Whether an invite from a waitlist lapsed: its area launched more than the TTL before now. */
export const inviteLapsed = (launchedAt: Date, now: Date): boolean =>
  now.getTime() > launchedAt.getTime() + INVITE_TTL_AFTER_LAUNCH_DAYS * DAY_MS;

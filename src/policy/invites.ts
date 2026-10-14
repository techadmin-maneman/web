// How long an invite lasts (docs/decisions/0048-referrals.md; ADR 0025, item 24): one to an area we do not serve yet
// stays good a year after the area launches, and one that has lapsed still books a free consultation but carries no
// credits, so a friend is never turned away for waiting. A lapsed invite is marked
// when its friend books (src/domain/referrals/referrals.ts), and again when their first fit is settled
// (src/domain/referrals/referral-grants.ts).

import { DAY_MS } from "../lib/durations.ts";

/** How long an invite to an unserved area lasts once the area launches: 12 months, as ruled. */
const INVITE_TTL_AFTER_LAUNCH_DAYS = 365;

/** Whether an invite from a waitlist lapsed: its area launched more than the TTL before now. */
export const inviteLapsed = (launchedAt: Date, now: Date): boolean =>
  now.getTime() > launchedAt.getTime() + INVITE_TTL_AFTER_LAUNCH_DAYS * DAY_MS;

/**
 * Codes that are not there an address may look up in an hour. Past them the address is refused every code, real or
 * not, until the hour is out: a code cannot be found by guessing, and the refusal says nothing about the code.
 */
export const INVITE_MISSES_PER_ADDRESS_HOURLY = 20;

// What looking up an invite costs the address it comes from (docs/decisions/0048-referrals.md): a code that is not
// there counts against the address, and an open counts in ops' funnel once a day for each address and code, so a
// reload, or a loop, adds nothing.

import { indiaDate, indiaHour } from "../lib/india-time.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "../policy/invites.ts";
import { isSpent, takeOne, type Limit } from "./rate-limit.ts";

function missesFrom(ipHash: string, now: Date): Limit {
  return { scope: "invite_miss:ip", key: ipHash, window: indiaHour(now), limit: INVITE_MISSES_PER_ADDRESS_HOURLY };
}

/** Whether this address has used up its misses this hour. Counts nothing. */
export function inviteMissesSpent(db: D1Database, ipHash: string, now: Date): Promise<boolean> {
  return isSpent(db, missesFrom(ipHash, now));
}

export async function countInviteMiss(db: D1Database, ipHash: string, now: Date): Promise<void> {
  await takeOne(db, missesFrom(ipHash, now));
}

/** Counts the invite opened, unless this address opened it already today. */
export async function countInviteOpen(db: D1Database, code: string, ipHash: string, now: Date): Promise<void> {
  const firstToday = await takeOne(db, {
    scope: "invite_open",
    key: `${code}:${ipHash}`,
    window: indiaDate(now),
    limit: 1,
  });
  if (!firstToday) return;
  await db.prepare("UPDATE referral_codes SET opens = opens + 1 WHERE code = ?1").bind(code).run();
}

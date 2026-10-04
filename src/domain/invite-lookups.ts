// What looking up an invite costs the address it comes from (docs/decisions/0048-referrals.md): a code that is not
// there counts against the address, and an open counts in ops' funnel once a day for each address and code, so a
// reload, or a loop, adds nothing.

import { isSpent, takeOne, type CountedAt } from "./rate-limit.ts";

/** Whether this address has used up its misses this hour. Counts nothing. */
export function inviteMissesSpent(db: D1Database, ipHash: string, at: CountedAt): Promise<boolean> {
  return isSpent(db, "invite_miss:ip", ipHash, at);
}

export async function countInviteMiss(db: D1Database, ipHash: string, at: CountedAt): Promise<void> {
  await takeOne(db, "invite_miss:ip", ipHash, at);
}

/** Counts the invite opened, unless this address opened it already today. */
export async function countInviteOpen(db: D1Database, code: string, ipHash: string, at: CountedAt): Promise<void> {
  const firstToday = await takeOne(db, "invite_open", `${code}:${ipHash}`, at);
  if (!firstToday) return;
  await db.prepare("UPDATE referral_codes SET opens = opens + 1 WHERE code = ?1").bind(code).run();
}

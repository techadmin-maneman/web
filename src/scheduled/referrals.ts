// The referral jobs on the five-minute cron (docs/decisions/0048-referrals.md): settle the referrals whose
// friend has been fitted, close expired credits, and take back the credits of a first fit refunded under the
// guarantee. Each does a little per pass. Returns the messages to queue.

import { expireCredits } from "../domain/credits.ts";
import { clawBackRefunded, settleReferrals } from "../domain/referral-grants.ts";
import type { Logger } from "../log.ts";

export async function referralPass(db: D1Database, now: Date, log: Logger): Promise<string[]> {
  const settled = await settleReferrals(db, now);
  const expired = await expireCredits(db, now);
  const clawedBack = await clawBackRefunded(db, now);
  if (settled.granted + settled.held + settled.expired + expired + clawedBack > 0) {
    log.info("referrals_settled", {
      granted: settled.granted,
      held: settled.held,
      invites_expired: settled.expired,
      credits_expired: expired,
      clawed_back: clawedBack,
    });
  }
  return settled.messageIds;
}

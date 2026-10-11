// The referral jobs on the cron, every fifteen minutes (docs/decisions/0048-referrals.md): settle the referrals whose
// friend has been fitted, a partner's as well as a client's (docs/decisions/0123-partner-referral-channels.md), under the reward ops have set (docs/decisions/0107-referral-rewards-in-the-console.md),
// close expired credits, and take back the credits of a first fit refunded under the guarantee. Each does a little
// per pass. Returns the messages to queue.

import { expireCredits } from "../domain/money/credits.ts";
import { clawBackPartnerRefunded, settlePartnerReferrals } from "../domain/referrals/channel-grants.ts";
import { clawBackRefunded, settleReferrals } from "../domain/referrals/referral-grants.ts";
import type { Logger } from "../log.ts";
import type { ReferralReward } from "../policy/referral-reward.ts";

export async function referralPass(db: D1Database, now: Date, log: Logger, reward: ReferralReward): Promise<string[]> {
  const settled = await settleReferrals(db, now, reward);
  const partners = await settlePartnerReferrals(db, now);
  const expired = await expireCredits(db, now);
  const clawedBack = (await clawBackRefunded(db, now)) + (await clawBackPartnerRefunded(db, now));
  const changed = settled.granted + settled.held + settled.expired + partners.granted + partners.expired;
  if (changed + expired + clawedBack > 0) {
    log.info("referrals_settled", {
      granted: settled.granted,
      held: settled.held,
      invites_expired: settled.expired,
      partner_granted: partners.granted,
      partner_invites_expired: partners.expired,
      credits_expired: expired,
      clawed_back: clawedBack,
    });
  }
  return [...settled.messageIds, ...partners.messageIds];
}

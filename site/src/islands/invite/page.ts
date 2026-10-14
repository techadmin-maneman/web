// What the landing reads from its own page: the code in the address, and what the mm-site Worker wrote in before
// any JavaScript ran (site/src/worker.ts), the invite on #invite and what a referral earns on <body>.

import type { Invite, ReferralReward } from "../../lib/api.ts";
import { isInvite } from "../../lib/invite.ts";
import { isReferralReward } from "../../lib/reward.ts";
import { INVITE_PATH } from "../../lib/invite.ts";

/**
 * The code in the address: /r/ABC123. Empty where the page is opened without one, and while
 * the page is built: Astro renders the island once on the server, where there is no address.
 */
export function codeInPath(): string {
  if (typeof location === "undefined") return "";
  return INVITE_PATH.exec(location.pathname)?.[1]?.toUpperCase() ?? "";
}

/** The invite the Worker wrote into the page, if it did and it reads as one. */
export function inviteInPage(): Invite | null {
  const written = document.getElementById("invite")?.dataset.invite;
  if (written === undefined || written === "") return null;
  try {
    const parsed: unknown = JSON.parse(written);
    return isInvite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** What a referral earns, as the Worker wrote it onto the page, if it did and it reads as one. Null while it is built. */
export function rewardInPage(): ReferralReward | null {
  if (typeof document === "undefined") return null;
  const written = document.body.dataset.reward;
  if (written === undefined || written === "") return null;
  try {
    const parsed: unknown = JSON.parse(written);
    return isReferralReward(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

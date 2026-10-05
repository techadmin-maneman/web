// What a referral earns, as the Refer pages read it (docs/decisions/0107-referral-rewards-in-the-console.md), and the
// invite a client not yet fitted came with.
//
// Each may be missing though the API's document says it is there: the service worker serves the Home it kept, which
// can be from before mm-api answered it, when the network is slow or absent, and an mm-api rolled back answers
// neither. So they are read through a partial view, and a page that has none gives no count and names no invite.

import type { Me, Refer } from "../api.ts";

type Reward = Me["referral_reward"];

/** The reward the Home card carries, or null where it carries none. */
export function rewardOf(me: Partial<Pick<Me, "referral_reward">>): Reward | null {
  return me.referral_reward ?? null;
}

/** The invite the client came with, while its visits wait on their first fit; null where the Home carries none. */
export function pendingInviteOf(me: Partial<Pick<Me, "pending_invite">>): Me["pending_invite"] {
  return me.pending_invite ?? null;
}

/** What the client earned for a fitted friend: none where the answer does not say. */
export function visitsFor(friend: Partial<Pick<Refer["fitted"][number], "visits">>): number {
  return friend.visits ?? 0;
}

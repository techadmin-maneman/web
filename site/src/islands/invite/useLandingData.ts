// What the booking pages (./Landing.tsx, ./Book.tsx) show before anyone types: the invite and what a referral earns.
// Each comes from the page where the mm-site Worker wrote it (./page.ts), otherwise from the API.

import { useEffect, useState } from "preact/hooks";
import { invitePageTitle } from "../../content/referral.ts";
import { fetchInvite, fetchReferralReward, type Invite, type ReferralReward } from "../../lib/api.ts";
import { isInvite } from "../../lib/invite.ts";
import { rememberInvite } from "../../lib/remembered-invite.ts";
import { isReferralReward } from "../../lib/reward.ts";
import { codeInPath, inviteInPage, rewardInPage } from "./page.ts";

/** On /r/:code, `invited`: the invite is read, a valid one remembered, and the tab titled by it. */
export function useLandingData(invited: boolean) {
  // Null until the invite is known: the page then says only what is true of every invite.
  const [invite, setInvite] = useState<Invite | null>(null);
  // Null until it is known: no sentence gives a count without it.
  const [reward, setReward] = useState<ReferralReward | null>(() => rewardInPage());

  useEffect(() => {
    if (!invited) return;
    const written = inviteInPage();
    if (written !== null) {
      setInvite(written);
      return;
    }
    const code = codeInPath();
    if (code === "") return;
    void fetchInvite(code).then((found) => {
      if (found.ok && isInvite(found.body)) setInvite(found.body);
    });
  }, [invited]);

  useEffect(() => {
    if (invited && invite?.state === "valid") rememberInvite(codeInPath());
  }, [invited, invite]);

  // The Worker titles the tab; where it could not look the invite up, the island does once it has.
  useEffect(() => {
    if (invited && invite !== null) document.title = invitePageTitle(invite);
  }, [invited, invite]);

  useEffect(() => {
    if (rewardInPage() !== null) return;
    void fetchReferralReward().then((found) => {
      if (found.ok && isReferralReward(found.body)) setReward(found.body);
    });
  }, []);

  return { invite, reward };
}

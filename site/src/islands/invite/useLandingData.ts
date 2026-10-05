// What the booking page (./Invite.tsx) shows before anyone types: the invite, the prices and what a referral earns.
// Each comes from the page where the mm-site Worker wrote it (./page.ts), otherwise from the API.

import { useEffect, useState } from "preact/hooks";
import { invitePageTitle } from "../../content/referral.ts";
import {
  fetchInvite,
  fetchPublishedPrices,
  fetchReferralReward,
  type Invite,
  type ReferralReward,
} from "../../lib/api.ts";
import { PRICES_SHOWN } from "../../lib/flags.ts";
import { isInvite } from "../../lib/invite.ts";
import { BUILT_WORDS, isPublishedPrices, pricesOf, priceWords, type PriceWords } from "../../lib/prices.ts";
import { rememberInvite } from "../../lib/remembered-invite.ts";
import { isReferralReward } from "../../lib/reward.ts";
import { codeInPath, inviteInPage, pricesInPage, rewardInPage } from "./page.ts";

/** On /r/:code, `invited`: the invite is read, a valid one remembered, and the tab titled by it. */
export function useLandingData(invited: boolean) {
  // Null until the invite is known: the page then says only what is true of every invite.
  const [invite, setInvite] = useState<Invite | null>(null);
  // Read before the first draw, so hydrating keeps the figures the Worker wrote into the page.
  const [prices, setPrices] = useState<PriceWords>(() => pricesInPage() ?? BUILT_WORDS);
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

  // Only while the site gives prices at all.
  useEffect(() => {
    if (!PRICES_SHOWN || pricesInPage() !== null) return;
    void fetchPublishedPrices().then((found) => {
      if (found.ok && isPublishedPrices(found.body)) setPrices(priceWords(pricesOf(found.body)));
    });
  }, []);

  useEffect(() => {
    if (rewardInPage() !== null) return;
    void fetchReferralReward().then((found) => {
      if (found.ok && isReferralReward(found.body)) setReward(found.body);
    });
  }, []);

  return { invite, prices, reward };
}

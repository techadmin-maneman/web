// Refer (board F): the invite, the card and the tracker.

import { freeServiceVisits, freeVisitsTile } from "./home.ts";
import { SERVICE_AREA } from "@maneman/web-kit/service-area";

/** What a referral earns each side, as ops set it in the console (docs/decisions/0107-referral-rewards-in-the-console.md). */
interface Reward {
  readonly referrer_visits: number;
  readonly friend_visits: number;
}

/** "1 service visit", "3 service visits". */
const serviceVisits = (count: number): string => (count === 1 ? "1 service visit" : `${String(count)} service visits`);

/**
 * Refer's promise, from the referrer's side, in the reward's one name: the sides equal or not, 0, or a reward not
 * known, which gives no count.
 */
function promiseOf(reward: Reward | null): string {
  const fitted = "When a friend you refer is fitted,";
  if (reward === null) return `${fitted} we tell you.`;
  const { referrer_visits: mine, friend_visits: theirs } = reward;
  if (mine === 0 && theirs === 0) return `${fitted} we tell you.`;
  if (mine === 0) return `${fitted} they get ${freeServiceVisits(theirs)}.`;
  if (theirs === mine) return `${fitted} you both get ${freeServiceVisits(mine)}.`;
  if (theirs === 0) return `${fitted} you get ${freeServiceVisits(mine)}.`;
  return `${fitted} you get ${freeServiceVisits(mine)}, and your friend gets ${String(theirs)}.`;
}

/** The promise as it reads before the client's own first fit: "Then, when a friend you refer is fitted, …". */
const afterTheFit = (promise: string): string => `Then, ${promise.charAt(0).toLowerCase()}${promise.slice(1)}`;

/** The invite a client not yet fitted came with: who sent it, where the invite names them. */
interface PendingInvite {
  readonly referrer_first_name: string | null;
}

/**
 * Refer for a client not yet fitted. Their own invite opens at their first
 * fit; an invite they came with comes first, with the visits it gives them.
 */
export function notYetFittedLines(reward: Reward | null, invite: PendingInvite | null): readonly [string, string] {
  const theirs = reward?.friend_visits ?? 0;
  if (invite === null || theirs === 0)
    return ["Referrals go live after your first fit.", afterTheFit(promiseOf(reward))];
  const whose = invite.referrer_first_name === null ? "Your friend’s invite" : `${invite.referrer_first_name}’s invite`;
  const arrive = theirs === 1 ? "arrives" : "arrive";
  return [
    `${whose}: your ${freeServiceVisits(theirs)} ${arrive} when you’re fitted.`,
    "Your own referrals go live after your first fit.",
  ];
}

/** Refer: the invite, the card behind it, and who has been fitted. */
export const refer = {
  title: "Refer",
  promise: promiseOf,
  /** Refer's credit tile, as Home's. */
  credit: freeVisitsTile,
  // The credits of the invite a client came with, while ops review them.
  inviteCredits: {
    checking: "Your invite’s free service visits are being checked. We’ll message you.",
    refused: "We couldn’t add your invite’s free service visits. Message us to find out why.",
  },
  share: "Share an invite",
  tracker: "See who has been fitted",
  /** Beneath the promise: how one goes, from the invite to the visits. */
  how: {
    label: "How it works",
    steps: [
      "Share your invite on WhatsApp.",
      "Your friend books a free consultation at home.",
      "Once they’re fitted, you both get the free visits.",
    ],
  },
  card: {
    title: "Which card?",
    what: "Pick the picture your friend sees. Your name and message go with it, never on it.",
    mine: { name: "My before and after", note: "Your own photos" },
    // Their own card needs a before and an after from the first fit.
    mineNotYet: "Your own before and after appears once your first-fit photos are in.",
    house: { name: "The Mane Man example card", note: "Our own before and after" },
    next: "Continue to share",
  },
  consent: {
    title: "Before you send your own photos",
    allow: "Allow for referral cards",
    instead: "Use the Mane Man example card",
  },
  /**
   * The chat's preview, exactly as the friend receives it. Its heading and line are the landing's own
   * preview (site/src/content/referral.ts), which test/node/apps/app/app-invite-preview.test.ts holds them to, so the
   * client is named only when the invite will name them, the friend promised only the visits ops give them, and
   * the area is the site's.
   */
  preview: {
    title: "Preview · what your friend sees",
    heading: (name: string | null) =>
      name === null ? "You have a Mane Man invite" : `${name} sent you a Mane Man invite`,
    body: (reward: Reward | null) => {
      const friend = reward?.friend_visits ?? 0;
      if (friend === 0) return `Home-fitted hair systems across ${SERVICE_AREA}.`;
      return `Home-fitted hair systems across ${SERVICE_AREA}. ${serviceVisits(friend)} free when you’re fitted.`;
    },
    domain: "maneman.in",
    // A first line that says nothing of the sender's own hair: the landing page says what Mane Man does.
    message: (link: string) => `Thought you’d like this: Mane Man, at home. ${link}`,
    via: "Share via",
    whatsapp: "WhatsApp",
    other: "Other apps",
    copy: "Copy link",
    copied: "Link copied",
    /** The empty tracker's share failure, and its way on. */
    failed: {
      label: "Share failed",
      line: "Couldn’t create your link. Try again.",
      retry: "Try again",
    },
  },
  fitted: {
    title: "Who has been fitted",
    /** The tracker's two figures, each above its word. */
    earned: "visits earned",
    remaining: "remaining",
    // A friend fitted before the grant kept first names, and erased since; never the erasure's word.
    unnamed: "A friend",
    when: (month: string) => `Fitted ${month}`,
    each: (visits: number) => (visits === 1 ? "1 visit earned" : `${String(visits)} visits earned`),
    only: "Friends show here once they’re fitted.",
    none: "Nobody you have referred has been fitted yet.",
    back: "Back to refer",
  },
  revoke: {
    open: "Switch off your photo card",
    title: "Switch off your photos?",
    body: "Anyone who opens your link from now on sees the Mane Man example card. Cards already sent stay in those chats.",
    yes: "Switch off",
    no: "Keep it on",
    // A revoke the API did not answer leaves the card as it was.
    failed: "Couldn’t switch your photos off. Try again.",
  },
  // The card is composed on the phone, so it can keep the client waiting, or fail.
  composing: "Making your card…",
  cardFailed: "We couldn’t make your card, so we’ve used the Mane Man example card instead.",
  /** Consent or the example did not go through: nothing changed, and nothing was shared. */
  notChanged: "Couldn’t save that. Try again.",
  close: "Close",
} as const;

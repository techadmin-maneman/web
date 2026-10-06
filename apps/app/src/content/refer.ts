// Refer (board F): the invite, the card and the tracker.

import { freeServiceVisits, freeVisitsTile } from "./home.ts";

/** What a referral earns each side, as ops set it in the console (docs/decisions/0107-referral-rewards-in-the-console.md). */
interface Reward {
  readonly referrer_visits: number;
  readonly friend_visits: number;
}

/** "1 service visit", "3 service visits". */
const serviceVisits = (count: number): string => (count === 1 ? "1 service visit" : `${String(count)} service visits`);

/**
 * Refer's promise, from the referrer's side, in the reward's one name. Our words: the words for unequal sides,
 * for 0 and for a reward not known, which gives no count (docs/decisions/0107-referral-rewards-in-the-console.md).
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

/** The invite a client not yet fitted came with: who sent it, where the invite names them. */
interface PendingInvite {
  readonly referrer_first_name: string | null;
}

/**
 * Refer for a client not yet fitted, which the board draws empty. Their own invite opens at their first
 * fit; an invite they came with comes first, with the visits it gives them.
 */
export function notYetFittedLines(reward: Reward | null, invite: PendingInvite | null): readonly [string, string] {
  const theirs = reward?.friend_visits ?? 0;
  if (invite === null || theirs === 0) return ["Your invite opens after your first fit.", promiseOf(reward)];
  const whose = invite.referrer_first_name === null ? "Your friend’s invite" : `${invite.referrer_first_name}’s invite`;
  const arrive = theirs === 1 ? "arrives" : "arrive";
  return [
    `${whose}: your ${freeServiceVisits(theirs)} ${arrive} when you’re fitted.`,
    "Your own invite opens after your first fit.",
  ];
}

/** Refer: the invite, the card behind it, and who has been fitted. */
export const refer = {
  title: "Refer",
  promise: promiseOf,
  /** Refer's credit tile, as Home's. */
  credit: freeVisitsTile,
  // The board draws no line for the credits of the invite a client came with while ops review them.
  inviteCredits: {
    checking: "The free service visits from the invite you came with are being checked. We’ll message you.",
    refused: "We couldn’t add the free service visits from your invite. Message us to find out why.",
  },
  share: "Share an invite",
  tracker: "See who has been fitted",
  card: {
    title: "Which card?",
    // In place of the board's line, which said the card carries no name.
    what: "Pick the picture your friend sees. Your name and message go with it, never on it.",
    mine: { name: "My before and after", note: "Your own photos" },
    // The board always offers their own card; it needs a before and an after from the first fit.
    mineNotYet: "Your own before and after appears once your first-fit photos are in.",
    house: { name: "A Mane Man example", note: "Our house sample" },
    next: "Continue to share",
  },
  consent: {
    title: "Before you send your own photos",
    allow: "Allow for referral cards",
    instead: "Use the example instead",
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
      if (friend === 0) return "Home-fitted hair systems across Delhi NCR.";
      return `Home-fitted hair systems across Delhi NCR. ${serviceVisits(friend)} free when you’re fitted.`;
    },
    domain: "maneman.in",
    // In place of the board's message.
    message: (link: string) => `Got my hair system fitted at home by Mane Man. Worth a look: ${link}`,
    via: "Share via",
    whatsapp: "WhatsApp",
    other: "Other apps",
    copy: "Copy link",
    copied: "Link copied",
    /** The empty tracker's share failure, and its way on. */
    failed: {
      label: "Share failed",
      line: "The link didn’t generate. Nothing was sent.",
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
    open: "Revoke the photo card",
    title: "Switch off your photos?",
    body: "New opens show the house example. Cards already sent stay in those chats.",
    yes: "Switch off",
    no: "Keep it on",
    // A revoke the API did not answer leaves the card as it was.
    failed: "That didn’t go through, and your photos are still on the card. Try again.",
  },
  // The card is composed on the phone; the design does not draw its waiting or its failures.
  composing: "Making your card.",
  cardFailed: "We couldn’t make your card, so we’ve used our example instead.",
  /** Consent or the example did not go through: nothing changed, and nothing was shared. */
  notChanged: "That didn’t go through, so nothing has changed. Try again.",
  close: "Close",
} as const;

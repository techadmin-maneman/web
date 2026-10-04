// The referral landing at /r/:code, word for word from the design
// (design/phase2/Referral and Waitlist, boards C1 to C5), except where we go
// and how long each visit takes, which are the site's own (service.ts).
//
// The prices are the site's own, from the price book (src/lib/prices.ts),
// because the design's open question rules that a referred friend sees the
// same figures. The referrer's name is filled in where {name} appears; without
// a name the page says "You have an invite" instead.
//
// What the invite earns is what ops set in the console, each side apart
// (docs/decisions/0107-referral-rewards-in-the-console.md), so no sentence types
// a count: each is built from the reward below. Where one side gets nothing, the
// page promises it nothing; where the reward is not known, no count is given.
// The words for unequal sides and for nothing are ours until the owner's (open
// point 172); with both sides at 3 they are the design's.

import type { Invite, OpenWindows, ReferralConsultation, ReferralReward } from "../lib/api.ts";
import { fill } from "../lib/text.ts";
import { capitalised, serviceArea, visitLength } from "./service.ts";
import { booking, notices, pageTitles, type Notice } from "./site.ts";

/** A one-line notice's words, as the backend records them with the consent (src/config/notices.ts). */
function lineOf(notice: Notice): string {
  const [line = ""] = notice.lines;
  return line;
}

/** "1 service visit", "3 service visits". */
function serviceVisits(count: number): string {
  return count === 1 ? "1 service visit" : `${String(count)} service visits`;
}

/** "1 visit", "3 visits": the design's shorter count, once the page has said what they are. */
function visits(count: number): string {
  return count === 1 ? "1 visit" : `${String(count)} visits`;
}

/** The verb that agrees with a count: "lands" for one, "land" for any other. */
function agreeing(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** The friend's visits, or none where the reward is not known. */
const friendVisits = (reward: ReferralReward | null): number => reward?.friend_visits ?? 0;

/** The navy block's offer (C1): what the invite earns each side. Null where it earns nobody anything. */
function inviteOffer(reward: ReferralReward): string | null {
  const { referrer_visits: referrer, friend_visits: friend } = reward;
  if (friend === 0 && referrer === 0) return null;
  if (friend === 0) return `Get fitted and your friend gets ${serviceVisits(referrer)} free.`;
  if (referrer === friend) return `Get fitted and you both get ${serviceVisits(friend)} free.`;
  if (referrer === 0) return `Get fitted and you get ${serviceVisits(friend)} free.`;
  return `Get fitted and you get ${serviceVisits(friend)} free. Your friend gets ${String(referrer)}.`;
}

/** A code we do not know, whose visits the friend does not get. */
function unknownBody(reward: ReferralReward | null): string {
  const friend = friendVisits(reward);
  if (friend === 0) return "The consultation is still free.";
  return `The consultation is still free; the ${serviceVisits(friend)} ${agreeing(friend, "does", "do")} not apply.`;
}

/** Beneath the form: who is told of the fit, and when the friend's visits land. */
function toldWhenFitted(name: string | null, reward: ReferralReward | null): string {
  const told =
    name === null ? "Whoever invited you is told when you are fitted." : `${name} is told when you are fitted.`;
  const friend = friendVisits(reward);
  if (friend === 0) return told;
  return `${told} That is when the ${visits(friend)} ${agreeing(friend, "lands", "land")}.`;
}

/** /book's line for the invite this browser remembers, above the consultation form's button. */
function rememberedOnBooking(reward: ReferralReward | null): string {
  return `You have an invite. ${toldWhenFitted(null, reward)}`;
}

/** The booked confirmation's line of the friend's visits (C4); null where they get none, or it is not known. */
function visitsLand(reward: ReferralReward | null): string | null {
  const friend = friendVisits(reward);
  if (friend === 0) return null;
  return `The ${serviceVisits(friend)} ${agreeing(friend, "lands", "land")} when you are fitted.`;
}

/** C4's "Code expired" frame's line. */
function expiredBody(reward: ReferralReward | null): string {
  const friend = friendVisits(reward);
  if (friend === 0) return "More than 12 months old. The consultation is still free.";
  return `More than 12 months old. The consultation is still free; the ${visits(friend)} ${agreeing(friend, "does", "do")} not apply.`;
}

export const referral = {
  /** The navy block at the top, before the pincode is known (C1). */
  arrival: {
    invited: "{name} sent you this",
    unnamed: "You have an invite",
    title: "A hair system, fitted at home. The consultation is free.",
    offer: inviteOffer,
    /**
     * A code we do not know: a typo, a revoked code, or one more than 12 months
     * old (board C4, "Code expired"). The API does not say which, so the page
     * says only what is true of all three, under /book's heading.
     */
    unknown: {
      title: booking.title,
      notice: "We do not recognise this invite",
      body: unknownBody,
    },
  },
  prices: {
    rows: [
      {
        what: "First fit, from",
        note: "The hair system you choose",
        amount: "{firstFit}",
        incl: "With the fitting and the cut",
      },
      {
        what: "Service visit",
        // Monthly, as the main site sells twelve service visits a year: the owner ruled the cadence 30 days on
        // 27 September 2026 (docs/archive/owner-answers-2026-09-27.md).
        note: "Every month, at home",
        amount: "{service}",
        incl: "Lifted, cleaned, re-bonded, trimmed",
      },
    ],
  },
  howItWorks: {
    title: "How it works",
    // The lengths are the backend's (service.ts), where the design wrote forty minutes and an hour.
    steps: [
      {
        n: "1",
        title: "A free consultation at home",
        body: `${capitalised(visitLength.consultation)}. A scalp template and a colour match.`,
      },
      {
        n: "2",
        title: "The fit, also at home",
        body: `${capitalised(visitLength.firstFit)}. You're wearing it by the end.`,
      },
      {
        n: "3",
        title: "A service visit every month",
        body: `Lifted, cleaned, re-bonded, trimmed. ${capitalised(visitLength.service)}.`,
      },
    ],
  },
  /** The pincode check, which decides whether the page books or takes a number (C1, C2, C3). */
  pincode: {
    title: "Do we come to you?",
    label: "Pincode",
    placeholder: "122018",
    check: "Check",
    checking: "Checking",
    empty: "Enter your pincode.",
    invalid: "That isn’t a six-digit Indian pincode.",
    failed: "We couldn’t check that right now. Try again.",
    // Not drawn: a pincode typed wrong could only be put right by reloading the page. The owner approves the words (open point 45).
    change: "Change",
    changeLabel: "Change the pincode",
  },
  /** The consultation form, shown when the pincode is served (C2). */
  consultation: {
    served: "We come to {area}",
    /** The form's heading on the invite, which follows what it books. */
    title: "Book a free consultation",
    titleOneVisit: "Book a consultation and fit",
    /** On the invite only: the site's own page says it in its introduction. */
    body: `${capitalised(visitLength.consultation)}, and free. Or have your fit in the same visit.`,
    forPincode: "For {pincode}",
    date: "Pick a date",
    window: "Window",
    // A no-break space keeps "am" and "pm" on the line of their hour.
    windows: [
      { id: "morning", label: "Morning", hours: "9 am to 12 pm" },
      { id: "afternoon", label: "Afternoon", hours: "12 to 4 pm" },
      { id: "evening", label: "Evening", hours: "4 to 8 pm" },
    ] satisfies readonly { id: ReferralConsultation["window"]; label: string; hours: string }[],
    // Not drawn: a window nobody is free in, and a fortnight with none open. The owner approves the words.
    full: "Full",
    noneOpen: "Fully booked for the next two weeks.",
    noneOpenAction: "Message us on WhatsApp for the next opening",
    /** Not drawn: what to book, the consultation alone or the consultation and fit in one visit. */
    plan: {
      legend: "What to book",
      options: [
        { id: "consultation", label: `Consultation · ${visitLength.consultation}` },
        { id: "one_visit", label: `Consultation and fit · ${visitLength.firstFit}` },
      ] satisfies readonly { id: OpenWindows["plan"]; label: string }[],
      // The first fit's three hours do not fit in the evening's half-slots, so the one visit starts earlier.
      note: "Starts in the morning or the afternoon. Choose your hair system with your technician and have it fitted there and then. Pay once fitted, by a link to your phone; decide against it and you pay nothing.",
      // Not drawn: no hair system is offered in the console yet, so only the consultation can be booked.
      notYet: "Consultation and fit in one visit isn’t open to book yet.",
    },
    /**
     * Not drawn: a discount code for the consultation and fit in one visit, on /book only, as the owner ruled on
     * 1 October 2026 (docs/decisions/0108-discount-codes.md). Placeholder words for the owner to approve, not marked,
     * since the mark refuses the site's production build (ADR 0081). A code that does not apply is told only that.
     */
    code: {
      label: "Discount code (optional)",
      hint: "It comes off the price of your hair system when you pay.",
    },
    consent: lineOf(notices.consultation),
    submit: "Book the consultation",
    submitOneVisit: "Book the consultation and fit",
    // Not drawn: once the WhatsApp code is on its way, the button confirms it and books. The owner approves the words.
    confirmOneVisit: "Confirm and book",
    sending: "Booking",
    told: toldWhenFitted,
  },
  /**
   * Not drawn: no board puts an address on the consultation form. The owner ruled on 27 September 2026 that the
   * site takes the full address before a consultation is booked (ADR 0025, item 62; ADR 0081), so the fields are
   * the client app's own (apps/app/src/content.ts, `profile.form`). The owner approves the words (open point 45).
   */
  address: {
    legend: "Your address",
    labels: {
      flat: "Flat or house number",
      floor: "Floor (optional)",
      tower: "Tower or block (optional)",
      line1: "Building or society",
      line2: "Street (optional)",
      landmark: "Landmark (optional)",
      locality: "Sector or area",
      city: "City",
      accessNotes: "Access notes (optional)",
    },
    errors: {
      flat: "Enter the flat or house number.",
      line1: "Enter the building or society.",
      locality: "Enter the sector or area.",
      city: "Enter the city.",
    },
    more: "Add floor, tower or landmark",
    pincode: "Pincode",
    accessHint: "A gate code, or where to park. Your technician sees it the day before the visit.",
  },
  /** The waitlist form, shown when the pincode is not served (C3). */
  waitlist: {
    title: "We are not in {area} yet",
    titleUnknown: "We are not there yet",
    body: `${serviceArea} only, for now.`,
    leave: "Leave us your number",
    forPincode: "For {pincode}{area}",
    contactConsent: lineOf(notices.waitlist),
    required: "Required",
    launchAlert: lineOf(notices.launchAlert),
    optional: "Optional",
    submit: "Add me to the list",
    sending: "Adding",
    // Not drawn: who is told, as the consultation form says it. The owner approves the words.
    holds: "{name}’s invite stays valid for 12 months after we launch there. {name} is told when you are fitted.",
    holdsUnnamed:
      "The invite stays valid for 12 months after we launch there. Whoever invited you is told when you are fitted.",
  },
  /**
   * Not drawn: /book's line for the invite this browser remembers, before the form sends it with the booking, so the
   * friend knows who is told of the fit and may go on without it. The owner approves the words.
   */
  remembered: {
    consultation: rememberedOnBooking,
    waitlist:
      "You have an invite. It stays valid for 12 months after we launch there. Whoever invited you is told when you are fitted.",
    bookWithout: "Book without the invite",
    joinWithout: "Join without the invite",
  },
  /** Shared between the two forms. */
  form: {
    name: "Name",
    namePlaceholder: "Your name",
    nameError: "Enter your name, in letters.",
    mobile: "Mobile",
    mobilePlaceholder: "Your number",
    mobileError: "Enter a valid 10-digit mobile number.",
    consentError: "We need this to contact you.",
    // Not drawn: by the button once three or more fields are marked. The owner approves the words.
    marked: "Check the {count} fields marked above.",
  },
  /**
   * What a booking answers (C4), the same for every number, since whoever typed it may not be its owner: the details
   * go to the number on WhatsApp, and the app shows them once its owner signs in with a code. Not drawn as worded
   * here; the owner approves the words.
   */
  booked: {
    label: "Booking received",
    title: "Check WhatsApp",
    body: "Your booking details are on their way to +91 {mobile}.",
    credits: visitsLand,
    // Not drawn: the discount code given with the one visit, as it stands on the booking, or not, when another
    // booking took its last use a moment before (ADR 0108). What it takes off is before GST. The owner approves the
    // words.
    code: {
      applied: (code: string, off: string) => `Code ${code}: ${off}, taken when you pay.`,
      notApplied: (code: string) => `We couldn’t apply code ${code}. Your booking stands without it.`,
      amountOff: (amount: string) => `${amount} off`,
      percentOff: (percent: number, cap: string | null) =>
        cap === null ? `${String(percent)}% off` : `${String(percent)}% off, up to ${cap}`,
    },
    appHint: "See it in the app too: sign in with this number.",
    app: "Open the app",
    back: "Back to the site",
  },
  /**
   * C4's "Code expired" frame. The invite has lapsed for this friend only, which the API can tell once they have
   * given their number, so the frame shows with the booking's answer rather than before it (ADR 0025, item 40).
   */
  expired: {
    label: "Code expired",
    title: "This invite has expired",
    body: expiredBody,
  },
  /**
   * C4's frame again, for a consultation nobody could book outright: self-serve
   * booking is off, so ops fix the hour on WhatsApp
   * (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
   */
  requested: {
    label: "Request received",
    title: "We will message you",
    body: "On WhatsApp, at +91 {mobile}, to fix the hour.",
  },
  listed: {
    label: "On the list",
    title: "You are on the {area} list",
    titleUnknown: "You are on the list",
    /** Only to someone who asked to be told: nobody else is messaged when we come (src/domain/waitlist.ts). */
    alerted: "We’ll message you on WhatsApp when we start coming to {pincode}.",
    creditsFrom: "{name}’s invite holds for 12 months from when we start coming to {pincode}.",
    credits: "The invite holds for 12 months from when we start coming to {pincode}.",
    tryOn: "Try a new look",
    back: "Back to the site",
  },
  errors: {
    rateLimited: "That’s too many tries for today. Try again tomorrow.",
    turnstile: "We couldn’t confirm you’re a person. Try again.",
    taken: "That time isn’t available. Pick another.",
    notBookable: "That day’s no longer open. Pick another.",
    other: "Something went wrong on our side. Try again.",
    // Not drawn: the discount code given does not apply, whatever the reason (ADR 0108). The owner approves the words.
    codeNotApplicable: "That discount code doesn’t apply. Check it, or leave it out to book without it.",
    // Not drawn: the one visit was asked for while no hair system is offered in the console.
    noProduct: "Consultation and fit in one visit isn’t open to book yet. Book the consultation instead.",
    // Not drawn: the WhatsApp code was entered more than 30 minutes before the booking was sent.
    notProved: "Your WhatsApp code has expired. Book again for a new one.",
  },
  /**
   * What a shared invite's preview says (boards B1 and B2), which the mm-site Worker writes into the page. Only a
   * valid invite promises the friend's visits, and only where there are any: any other books without them.
   */
  preview: {
    title: "{name} sent you a Mane Man invite",
    titleUnnamed: "You have a Mane Man invite",
    description: (friend: number) =>
      `Home-fitted hair systems across ${serviceArea}. ${serviceVisits(friend)} free when you're fitted.`,
    descriptionWithout: `Home-fitted hair systems across ${serviceArea}.`,
  },
};

/** The title a shared invite carries. */
export function inviteTitle(name: string | null): string {
  return name === null ? referral.preview.titleUnnamed : fill(referral.preview.title, { name });
}

/** The browser tab's title: the invite's own, or /book's for a code we do not know, which the page is headed as. */
export function invitePageTitle(invite: Invite | null): string {
  if (invite?.state === "unknown") return pageTitles.book;
  return inviteTitle(invite?.referrer_first_name ?? null);
}

/**
 * The preview's description: the friend's visits only for an invite that carries them, never for one we could not
 * read, and never a count the reward does not give or that is not known.
 */
export function inviteDescription(invite: Invite | null, reward: ReferralReward | null): string {
  const friend = friendVisits(reward);
  if (invite?.state !== "valid" || friend === 0) return referral.preview.descriptionWithout;
  return referral.preview.description(friend);
}

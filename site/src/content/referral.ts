// The referral landing at /r/:code, word for word from the design
// (design/phase2/Referral and Waitlist), except where we go
// and how long each visit takes, which are the site's own (service.ts).
//
// It gives no prices, as the site gives none
// (docs/decisions/0204-the-sites-price-pipeline-removed.md). The referrer's name
// is filled in where {name} appears; without a name the page says "You have an
// invite" instead.
//
// What the invite earns is what ops set in the console, each side apart
// (docs/decisions/0107-referral-rewards-in-the-console.md), so no sentence types
// a count: each is built from the reward below. Where one side gets nothing, the
// page promises it nothing; where the reward is not known, no count is given.
// The words for unequal sides and for nothing are ADR 0107's; with both sides at 3
// they are the design's.

import type { Invite, OpenWindows, ReferralConsultation, ReferralReward } from "../lib/api.ts";
import { rupees } from "@maneman/web-kit/money";
import { fill } from "../lib/text.ts";
import { capitalised, serviceArea, visitLength } from "./service.ts";
import { booking, notices, pageTitles, type Notice } from "./site.ts";

/** A one-line notice's words, as the backend records them with the consent (src/config/notices.ts). */
function lineOf(notice: Notice): string {
  const [line = ""] = notice.lines;
  return line;
}

/**
 * The sentences that give what an invite earns, each count a hole, so the Words page can change them
 * (docs/decisions/0126-the-words-page.md). Where a verb agrees with a count, each count has its own sentence.
 */
export const rewardWords = {
  serviceVisit: "{count} service visit",
  serviceVisits: "{count} service visits",
  /** The design's shorter count, once the page has said what they are. */
  visit: "{count} visit",
  visits: "{count} visits",
  /** The navy block's offer, "you" the friend who opened it and "your friend" whoever sent it. */
  offer: {
    toReferrer: "Get fitted and your friend gets {referrer} free.",
    both: "Get fitted and you both get {friend} free.",
    toFriend: "Get fitted and you get {friend} free.",
    unequal: "Get fitted and you get {friend} free. Your friend gets {referrerCount}.",
  },
  /** A partner's discount, which comes off the friend's first fit by itself. */
  discount: {
    amount: "{amount} off your first fit.",
    percent: "{percent}% off your first fit.",
    percentCapped: "{percent}% off your first fit, up to {cap}.",
  },
  /** A code we do not know, whose visits the friend does not get. */
  unknown: {
    free: "The consultation is still free.",
    one: "The consultation is still free; the {visits} does not apply.",
    many: "The consultation is still free; the {visits} do not apply.",
  },
  /** Beneath the form: who is told of the fit, then when the friend's visits land. */
  told: {
    named: "{name} is told when you are fitted.",
    unnamed: "Whoever invited you is told when you are fitted.",
    landsOne: "{told} That is when the {visits} lands.",
    landsMany: "{told} That is when the {visits} land.",
  },
  /** /book's line for the invite this browser remembers, above the consultation form's button. */
  remembered: "You have an invite. {told}",
  /** The booked confirmation's line of the friend's visits. */
  credits: { one: "The {visits} lands when you are fitted.", many: "The {visits} land when you are fitted." },
  /** C4's "Code expired" frame's line. */
  expired: {
    free: "More than 12 months old. The consultation is still free.",
    one: "More than 12 months old. The consultation is still free; the {visits} does not apply.",
    many: "More than 12 months old. The consultation is still free; the {visits} do not apply.",
  },
};

/** "1 service visit", "3 service visits". */
function serviceVisits(count: number): string {
  return fill(count === 1 ? rewardWords.serviceVisit : rewardWords.serviceVisits, { count: String(count) });
}

/** "1 visit", "3 visits". */
function visits(count: number): string {
  return fill(count === 1 ? rewardWords.visit : rewardWords.visits, { count: String(count) });
}

/** The friend's visits, or none where the reward is not known. */
const friendVisits = (reward: ReferralReward | null): number => reward?.friend_visits ?? 0;

/**
 * What an invite earns each side: the reward ops set, or a partner's own, which gives the friend its visits and the
 * partner nothing in visits (docs/decisions/0123-partner-referral-channels.md).
 */
export function inviteReward(invite: Invite | null, reward: ReferralReward | null): ReferralReward | null {
  const visits = invite?.partner === null ? null : (invite?.friend_visits ?? null);
  if (visits === null) return reward;
  return { referrer_visits: 0, friend_visits: visits, valid_days: reward?.valid_days ?? 0 };
}

/** The navy block's offer: what the invite earns each side. Null where it earns nobody anything. */
function inviteOffer(reward: ReferralReward): string | null {
  const { referrer_visits: referrer, friend_visits: friend } = reward;
  const { offer } = rewardWords;
  if (friend === 0 && referrer === 0) return null;
  if (friend === 0) return fill(offer.toReferrer, { referrer: serviceVisits(referrer) });
  const words = { friend: serviceVisits(friend), referrerCount: String(referrer) };
  if (referrer === friend) return fill(offer.both, words);
  return fill(referrer === 0 ? offer.toFriend : offer.unequal, words);
}

/**
 * A partner's discount, which comes off the friend's first fit by itself (docs/decisions/0125-partner-discount-codes.md):
 * "Rs. 2,000 off your first fit.", or "20% off your first fit, up to Rs. 5,000."
 */
function discountOffer(terms: NonNullable<Invite["discount"]>): string {
  const { discount } = rewardWords;
  if (terms.kind === "amount") return fill(discount.amount, { amount: rupees(terms.value) });
  const percent = String(terms.value);
  return terms.cap === null
    ? fill(discount.percent, { percent })
    : fill(discount.percentCapped, { percent, cap: rupees(terms.cap) });
}

/** One of three sentences by the friend's visits: none, one, or more. */
function byVisits(friend: number, sentences: { free: string; one: string; many: string }, count: string): string {
  if (friend === 0) return sentences.free;
  return fill(friend === 1 ? sentences.one : sentences.many, { visits: count });
}

/** A code we do not know, whose visits the friend does not get. */
function unknownBody(reward: ReferralReward | null): string {
  const friend = friendVisits(reward);
  return byVisits(friend, rewardWords.unknown, serviceVisits(friend));
}

/** Beneath the form: who is told of the fit, and when the friend's visits land. */
function toldWhenFitted(name: string | null, reward: ReferralReward | null): string {
  const { told: words } = rewardWords;
  const told = name === null ? words.unnamed : fill(words.named, { name });
  const friend = friendVisits(reward);
  if (friend === 0) return told;
  return fill(friend === 1 ? words.landsOne : words.landsMany, { told, visits: visits(friend) });
}

/** /book's line for the invite this browser remembers, above the consultation form's button. */
function rememberedOnBooking(reward: ReferralReward | null): string {
  return fill(rewardWords.remembered, { told: toldWhenFitted(null, reward) });
}

/** The booked confirmation's line of the friend's visits; null where they get none, or it is not known. */
function visitsLand(reward: ReferralReward | null): string | null {
  const friend = friendVisits(reward);
  if (friend === 0) return null;
  return fill(friend === 1 ? rewardWords.credits.one : rewardWords.credits.many, { visits: serviceVisits(friend) });
}

/** C4's "Code expired" frame's line. */
function expiredBody(reward: ReferralReward | null): string {
  const friend = friendVisits(reward);
  return byVisits(friend, rewardWords.expired, visits(friend));
}

export const referral = {
  /** The navy block at the top, before the pincode is known. */
  arrival: {
    invited: "{name} sent you this",
    partner: "Recommended by {partner}",
    unnamed: "You have an invite",
    title: "A hair system, fitted at home. The consultation is free.",
    offer: inviteOffer,
    discount: discountOffer,
    /**
     * A code we do not know: a typo, a revoked code, or one more than 12 months
     * old (the design's "Code expired"). The API does not say which, so the page
     * says only what is true of all three, under /book's heading.
     */
    unknown: {
      title: booking.title,
      notice: "We do not recognise this invite",
      body: unknownBody,
    },
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
    // Not drawn: a pincode typed wrong could only be put right by reloading the page.
    change: "Change",
    changeLabel: "Change the pincode",
  },
  /** The consultation form, shown when the pincode is served. */
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
    // Not drawn: a window nobody is free in, and a fortnight with none open.
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
    },
    /**
     * Not drawn: a discount code for the consultation and fit in one visit, on /book only
     * (docs/decisions/0108-discount-codes.md). A code that does not apply is told only that.
     */
    code: {
      label: "Discount code (optional)",
      hint: "It comes off the price of your hair system when you pay.",
    },
    consent: lineOf(notices.consultation),
    submit: "Book the consultation",
    submitOneVisit: "Book the consultation and fit",
    // Not drawn: once the WhatsApp code is on its way, the button confirms it and books.
    confirmOneVisit: "Confirm and book",
    sending: "Booking",
    told: toldWhenFitted,
  },
  /**
   * Not drawn: the design puts no address on the consultation form. The site takes the full address before a
   * consultation is booked (ADR 0081), so the fields are the client app's own (apps/app/src/content.ts, `profile.form`).
   */
  address: {
    legend: "Your address",
    /** The building search, as the client app words it: the technician finds the door by the building's pin. */
    building: {
      label: "Search for your building",
      hint: "Search for your building or society, so your technician can find you.",
      unavailable: "Search isn’t available right now. Type your address below instead.",
      foundOne: "1 building found",
      foundMany: "{count} buildings found",
      // Google asks for their name against suggestions shown without a map.
      attribution: "Google Maps",
    },
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
  /** The waitlist form, shown when the pincode is not served. */
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
    // Not drawn: who is told, as the consultation form says it.
    holds: "{name}’s invite stays valid for 12 months after we launch there. {name} is told when you are fitted.",
    holdsUnnamed:
      "The invite stays valid for 12 months after we launch there. Whoever invited you is told when you are fitted.",
  },
  /**
   * Not drawn: /book's line for the invite this browser remembers, before the form sends it with the booking, so the
   * friend knows who is told of the fit and may go on without it.
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
    nameError: "Enter your name in letters.",
    mobile: "Mobile",
    mobilePlaceholder: "Your number",
    mobileError: "Enter a valid 10-digit mobile number.",
    consentError: "We need this to contact you.",
    /** Beneath the agreement on every form that takes a name and number: what binds the visitor, and to read it. */
    legal: { before: "Our ", terms: "terms", between: " and ", privacy: "privacy notice", after: " apply." },
    // Not drawn: by the button once three or more fields are marked.
    marked: "Check the {count} fields marked above.",
  },
  // Not drawn, beyond the label and the WhatsApp line: the day and window picked, what the visit asks of the client,
  // and the calendar. They restate what was typed, so they tell whoever typed it nothing about the number.
  /**
   * What a booking answers, the same for every number, since whoever typed it may not be its owner: the details
   * go to the number on WhatsApp, and the app shows them once its owner signs in with a code. Not drawn as worded
   * here.
   */
  booked: {
    label: "Booked",
    when: "{day}, {hours}",
    body: "Your technician arrives in that window. Details are on WhatsApp at +91 {mobile}.",
    ready: {
      consultation: `${capitalised(visitLength.consultation)} at home, and free. Nothing is fitted.`,
      oneVisit: `${capitalised(visitLength.firstFit)} at home. You pay once fitted, by a link to your phone.`,
    },
    calendar: {
      label: "Add to your calendar",
      google: "Google Calendar",
      file: "Apple or Outlook",
      fileName: "mane-man-visit.ics",
      title: { consultation: "Mane Man consultation", oneVisit: "Mane Man consultation and fit" },
      details: "Arriving {hours}. {ready}",
    },
    credits: visitsLand,
    // Not drawn: the discount code given with the one visit, as it stands on the booking, or not, when another
    // booking took its last use a moment before (ADR 0108). What it takes off is before GST.
    code: {
      applied: "Code {code}: {off}, taken when you pay.",
      notApplied: "We couldn’t apply code {code}. Your booking stands without it.",
      amountOff: "{amount} off",
      percentOff: "{percent}% off",
      percentOffCapped: "{percent}% off, up to {cap}",
    },
    appHint: "See it in the app too: sign in with this number.",
    app: "Open the app",
    back: "Back to the site",
  },
  /**
   * C4's "Code expired" frame. The invite has lapsed for this friend only, which the API can tell once they have
   * given their number, so the frame shows with the booking's answer rather than before it (ADR 0025).
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
    /** Only to someone who asked to be told: nobody else is messaged when we come (src/domain/booking/waitlist.ts). */
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
    // Not drawn: the discount code given does not apply, whatever the reason (ADR 0108).
    codeNotApplicable: "That discount code doesn’t apply. Check it, or leave it out to book without it.",
    // Not drawn: the one visit was asked for while no hair system is offered in the console.
    noProduct: "Consultation and fit in one visit isn’t open to book yet. Book the consultation instead.",
    // Not drawn: the WhatsApp code was entered more than 30 minutes before the booking was sent.
    notProved: "Your WhatsApp code has expired. Book again for a new one.",
  },
  /**
   * What a shared invite's preview says, which the mm-site Worker writes into the page. Only a
   * valid invite promises the friend's visits, and only where there are any: any other books without them.
   */
  preview: {
    title: "{name} sent you a Mane Man invite",
    titleUnnamed: "You have a Mane Man invite",
    titlePartner: "Mane Man, recommended by {partner}",
    description: `Home-fitted hair systems across ${serviceArea}. {visits} free when you’re fitted.`,
    descriptionWithout: `Home-fitted hair systems across ${serviceArea}.`,
  },
};

/** The title a shared invite carries: a partner's names the partner (docs/decisions/0123-partner-referral-channels.md). */
export function inviteTitle(name: string | null, partner: string | null = null): string {
  if (partner !== null) return fill(referral.preview.titlePartner, { partner });
  return name === null ? referral.preview.titleUnnamed : fill(referral.preview.title, { name });
}

/** The browser tab's title: the invite's own, or /book's for a code we do not know, which the page is headed as. */
export function invitePageTitle(invite: Invite | null): string {
  if (invite?.state === "unknown") return pageTitles.book;
  return inviteTitle(invite?.referrer_first_name ?? null, invite?.partner ?? null);
}

/**
 * The preview's description: the friend's visits only for an invite that carries them, never for one we could not
 * read, and never a count the reward does not give or that is not known.
 */
export function inviteDescription(invite: Invite | null, reward: ReferralReward | null): string {
  const friend = friendVisits(inviteReward(invite, reward));
  if (invite?.state !== "valid" || friend === 0) return referral.preview.descriptionWithout;
  return fill(referral.preview.description, { visits: serviceVisits(friend) });
}

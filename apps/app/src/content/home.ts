// Home (board B) and the tabs beneath every screen, and what a replacement involves.

import { visitLength } from "./common.ts";

export const tabs = [
  { page: "/", label: "Home", icon: "home" },
  { page: "/visits", label: "Visits", icon: "visits" },
  { page: "/photos", label: "Photos", icon: "photos" },
  { page: "/payments", label: "Payments", icon: "payments" },
  { page: "/refer", label: "Refer", icon: "refer" },
] as const;

/**
 * The referral reward has this one name wherever the client reads it: "1 free service visit", "3 free
 * service visits".
 */
export const freeServiceVisits = (count: number): string =>
  count === 1 ? "1 free service visit" : `${String(count)} free service visits`;

/** Home's and Refer's tile: how many free service visits, and the day the soonest must be used by. */
export const freeVisitsTile = {
  count: freeServiceVisits,
  useBy: (when: string) => `Use by ${when}`,
  /** Only some of them end first: "1 to use by 2 Oct". */
  someUseBy: (visits: number, when: string) => `${String(visits)} to use by ${when}`,
  tonight: "tonight",
};

/** The booking sheet's words for a paid visit still being booked, which Home repeats while it waits. */
export const PAID_IN = "Your payment is in. We are booking your visit.";

export const TOLD_WHEN_BOOKED = "We’ll message you on WhatsApp when it’s booked.";

export const home = {
  /** The avatar's name begins with the initials it shows, so "tap RM" reaches it by voice. */
  profile: (initials: string) => `${initials}, your profile`,
  reschedule: "Reschedule",
  note: "Add a note",
  consultation: {
    label: "Your consultation",
    labelOneVisit: "Your consultation and fit",
    free: "Free",
    /** Asked for on the site, not yet booked. */
    requested: "Requested · we confirm the time on WhatsApp",
  },
  /** Board B1's credit tile: "3 free service visits", and "Use by 2 Oct", or "Use by tonight" on the last day. */
  credits: freeVisitsTile,
  /**
   * Board B1's one prompt, and the invoice line beneath it (src/domain/home-prompt.ts). The replacement's line and
   * "See what that involves" are the board's own, and Visits' record words the line the same way. Our words:
   * everything else here.
   */
  prompt: {
    address: "Add your address, so your technician can find the door.",
    addAddress: "Add your address",
    /** "Your next service visit is due on Tue 27 Oct, in the morning." */
    nextVisit: (what: string, date: string, window: string | null) =>
      window === null
        ? `Your next ${what.toLowerCase()} is due on ${date}.`
        : `Your next ${what.toLowerCase()} is due on ${date}, in the ${window.toLowerCase()}.`,
    /** Once its due day has passed: "Your service visit was due on Thu 24 Sep." */
    wasDue: (what: string, date: string) => `Your ${what.toLowerCase()} was due on ${date}.`,
    /** The booking sheet, with the day and window chosen. */
    bookNext: "Book it for then",
    /** The booking sheet at the day offered, once the due day has passed: "Book it for Sat 3 Oct". */
    bookOn: (date: string) => `Book it for ${date}`,
    /** The booking sheet, at the replacement. */
    bookReplacement: "Book the replacement",
    involves: "See what that involves",
    invoice: (what: string, date: string) => `The invoice for your ${what.toLowerCase()} on ${date} is ready.`,
    openInvoice: "Open the invoice",
  },
  /** A visit not yet closed, once it has begun (LIFE-03). Our words: the design draws neither. */
  stages: { in_progress: "Today · in progress", done: "Done · notes on the way", closing: "Wrapping up" },
  next: {
    label: "Your next visit",
    /** "Service visit · 1 hour 30 minutes". */
    length: (what: string, minutes: number) => `${what} · ${visitLength(minutes)}`,
    // The design draws no Home for a fitted client with nothing booked.
    none: "Nothing booked yet.",
    /** Board C1's button, which Home's card and Visits both show. */
    book: "Book your next visit",
    // A lead whose consultation is done.
    bookFirstFit: "Book your first fit",
    // A fitted client whose piece falls due before their next service would.
    bookReplacement: "Book your replacement",
    // The other kind of visit a fitted client may book, beside the one the app offers.
    orReplacement: "Or book a replacement",
    orService: "Or book a service visit",
  },
  expect: {
    label: "What to expect",
    steps: [
      "A template of your scalp, in cling film and tape.",
      "Your colour matched against forty samples.",
      "Nothing fitted, nothing ordered on the day.",
    ],
  },
  /**
   * Our words, all of them: a consultation and fit in one visit, on its card and beneath it. No board draws it. Its
   * price is GST included, after any discount code.
   */
  oneVisit: {
    label: "Your consultation and fit",
    price: (amount: string) => `${amount}, only if you go ahead`,
    /** The hair systems differ in price: what the least of them costs. */
    from: (amount: string) => `From ${amount}, only if you go ahead`,
    unpriced: "You pay only if you go ahead",
    covered: (code: string) => `Nothing to pay: code ${code} covers it`,
    code: (code: string) => `Code ${code} applied`,
    paidBy: "Paid once fitted, by a link we text you",
    expect: [
      "Your scalp measured and your colour matched.",
      "Choose your hair system, fitted there and then.",
      "Go ahead and pay by the link we text you. Decide against it and pay nothing.",
    ],
  },
  /** No board draws it. A one visit the client was fitted at and has not paid for yet. */
  owed: {
    label: "Payment owed",
    line: (product: string, amount: string) => `${product} · ${amount}`,
    pay: "Pay now",
    newTab: "opens Razorpay in a new tab",
    onItsWay: "Your payment link is on its way by text.",
  },
  /**
   * A visit paid for, or booked free, that is not booked yet (docs/decisions/0068-a-paid-hold-is-kept.md): the booking
   * sheet's own words for a booking being written. Our words: the free line, and the design draws none.
   */
  beingBooked: {
    paid: PAID_IN,
    free: "We are booking your visit.",
    told: TOLD_WHEN_BOOKED,
  },
  // The design draws no Home for a client with nothing booked.
  nothing: {
    title: "Nothing booked",
    book: "Book a free consultation",
  },
} as const;

/**
 * Our words, all of them: the page on what a replacement involves, which Home's prompt opens in place of a WhatsApp
 * message to us (docs/open-points.md, item 46; ADR 0086). No board draws it.
 */
export const replacement = {
  title: "What a replacement involves",
  back: "Back to Home",
  lines: [
    "A replacement takes off the hair system you wear now and fits a new one in its place, at home, by your technician.",
    "The new hair system is cut in and styled to match, as it was at your first fit.",
    "It is booked here like any other visit, and paid for when you book it.",
  ],
  book: "Book the replacement",
} as const;

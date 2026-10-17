// Home (board B) and the tabs beneath every screen, and what a replacement involves.

import { visitLength } from "./common.ts";

export const tabs = [
  { page: "/", label: "Home", icon: "home" },
  { page: "/visits", label: "Visits", icon: "visits" },
  { page: "/photos", label: "Photos", icon: "photos" },
  { page: "/payments", label: "Payments", icon: "payments" },
  { page: "/refer", label: "Refer", icon: "refer" },
] as const;

/** The tab bar, as a screen reader names it. */
export const tabsLabel = "Main";

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
export const PAID_IN = "Your payment is in. We’re booking your visit.";

export const TOLD_WHEN_BOOKED = "We’ll message you on WhatsApp when it’s booked.";

export const home = {
  /** The avatar's name begins with the initials it shows, so "tap RM" reaches it by voice. */
  profile: (initials: string) => `${initials}, your profile`,
  reschedule: "Change or cancel",
  /**
   * A move to another day ops asked the client to confirm (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md).
   * The card's Reschedule reads "Pick another time" beside it.
   */
  proposal: {
    ask: (when: string, technician: string | null) =>
      technician === null
        ? `We need to move this visit. Could you do ${when} instead?`
        : `We need to move this visit. Could you do ${when} with ${technician} instead?`,
    accept: (date: string) => `Accept ${date}`,
    pick: "Pick another time",
    gone: "That time has just gone. Pick another.",
    failed: "That didn’t go through. Try again.",
  },
  note: "Add a note",
  consultation: {
    label: "Your consultation",
    labelOneVisit: "Your consultation and fit",
    free: "Free",
    /** Asked for on the site, not yet booked. */
    requested: "Requested · we confirm the time on WhatsApp",
  },
  /** Home's credit tile: "3 free service visits", and "Use by 2 Oct", or "Use by tonight" on the last day. */
  credits: freeVisitsTile,
  /** A hair system made to their profile, as it comes to them (docs/decisions/0177-custom-orders-in-the-app.md). */
  customOrder: {
    awaitingPayment: "Your hair system, made to your profile, is ready to order.",
    pay: (amount: string) => `Pay ${amount}`,
    paid: "Paid in full. We are placing your order.",
    ordered: (date: string | null) =>
      date === null ? "Your hair system is being made." : `Your hair system is being made, due by ${date}.`,
    arrived: "Your hair system has arrived. We’ll message you to book your first fit.",
  },
  /**
   * Home's one prompt, and the invoice line beneath it (src/domain/clients/home-prompt.ts). Visits' record words the
   * replacement's line the same way.
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
  /** A visit not yet closed, once it has begun. */
  stages: {
    arrived: "Your technician is at the door",
    in_progress: "Today · in progress",
    done: "Done · record on its way",
    closing: "Wrapping up",
    missed: "We’ll be in touch about this visit",
  },
  next: {
    label: "Your next visit",
    /** "Service visit · 1 hour 30 minutes". */
    length: (what: string, minutes: number) => `${what} · ${visitLength(minutes)}`,
    none: "Nothing booked yet.",
    /** Visits' button, which Home's card and Visits both show. */
    book: "Book your next visit",
    // A lead whose consultation is done.
    bookFirstFit: "Book your first fit",
    // A fitted client whose piece falls due before their next service would.
    bookReplacement: "Book your replacement",
    // The other kind of visit a fitted client may book, beside the one the app offers.
    orReplacement: "Or book a replacement",
    orService: "Or book a service visit",
    /** Beside a replacement due first, for a client holding free service visits. */
    useCredit: "Use a free service visit",
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
   * A consultation and fit in one visit, on its card and beneath it. Its
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
    paidBy: "By UPI at the visit, once fitted",
    expect: [
      "Your scalp measured and your colour matched.",
      "Choose your hair system, fitted there and then.",
      "Decide before it’s fitted: go ahead and pay by UPI once fitted, or decide against it and pay nothing.",
    ],
  },
  /** A visit nobody was home for, until ops decide what follows and the client is told. */
  missed: {
    label: "We missed you",
    /** "Imran came by on Thu 15 Oct and couldn't reach you." */
    line: (date: string, technician: string | null) =>
      `${technician ?? "We"} came by on ${date} and couldn’t reach you.`,
    next: "We’ll message you about what happens next.",
  },
  /** A one visit the client was fitted at and has not paid for yet. */
  owed: {
    label: "To pay",
    line: (product: string, amount: string) => `${product} · ${amount}`,
    pay: "Pay now",
    newTab: "opens Razorpay in a new tab",
    /** No link to pay by: Razorpay could not make one, or online payment is off. Ops are told, and settle it. */
    onItsWay: "We’ll message you to settle this.",
  },
  /**
   * A visit paid for, or booked free, that is not booked yet (docs/decisions/0068-a-paid-hold-is-kept.md): the booking
   * sheet's own words for a booking being written.
   */
  beingBooked: {
    paid: PAID_IN,
    free: "We’re booking your visit.",
    told: TOLD_WHEN_BOOKED,
  },
  /** The consultation done and the first fit not yet booked. */
  consulted: {
    label: "Your consultation",
    /** "Thu 8 Oct · Imran". */
    when: (date: string, technician: string | null) => (technician === null ? date : `${date} · ${technician}`),
    recommends: (technician: string | null, product: string) =>
      `${technician ?? "Your technician"} recommends ${product}.`,
  },
  /**
   * A first fit or replacement we owe the client again, free, which we call to book
   * (docs/decisions/0192-free-remakes.md).
   */
  remake: {
    label: { first_fit: "Your first fit", replacement: "Your replacement" },
    partial: "We’ll call you to set a new day.",
    recall: "We’re replacing your hair system, at no cost. We’ll call you to set a day.",
  },
  nothing: {
    title: "Nothing booked",
    book: "Book a free consultation",
  },
} as const;

/**
 * The page on what a replacement involves, which Home's prompt opens in place of a WhatsApp
 * message to us (docs/open-points.md, item 46; ADR 0086).
 */
export const replacement = {
  title: "What a replacement involves",
  back: "Back to Home",
  lines: [
    "Your technician removes your current hair system and fits a new one, at home.",
    "It’s cut in and styled to match, just like your first fit.",
    "Book and pay here, like any other visit.",
  ],
  book: "Book the replacement",
} as const;

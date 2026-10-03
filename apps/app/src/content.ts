// Every word the client app shows, from design/phase2/Client App.dc.html. A
// component holds no copy of its own. Lines the design does not draw are
// marked PLACEHOLDER, pending the owner's wording.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";

export const app = {
  /** Last in the browser's title, after the screen's own name: "Visits · Mane Man". */
  name: "Mane Man",
} as const;

/**
 * Each page's name in the browser's title (WCAG 2.4.2), by the route it is at (apps/app/src/route.ts).
 * PLACEHOLDER where no board names the page.
 */
export const titles = {
  home: "Home",
  visits: "Visits",
  visit: "Visit",
  photos: "Photos",
  compare: "Compare",
  payments: "Payments",
  entry: "Payment",
  refer: "Refer",
  fitted: "Who has been fitted",
  profile: "Your profile",
  replacement: "Replacement piece",
} as const;

export const whatsapp = {
  /** The business WhatsApp number, as the public site's footer and wa.me links use it. */
  number: WHATSAPP_NUMBER,
} as const;

/** The public site's booking page, for a number with no booking yet (board A3). */
export const BOOKING_URL: Readonly<Record<string, string>> = {
  local: "http://127.0.0.1:4321/book",
  staging: "https://staging.maneman.in/book",
  production: "https://maneman.in/book",
};

export const login = {
  mobile: {
    title: "Your mobile number",
    prefix: "+91",
    label: "Mobile number",
    send: "Send code on WhatsApp",
    hint: "A six-digit code, no password.",
    // PLACEHOLDER: the design draws no session that ended while the app was open.
    ended: "Your session has ended. Log in again to carry on.",
    // PLACEHOLDER: the design draws no error on A1.
    errors: {
      invalid: "Enter the ten-digit mobile number you booked with.",
      rate_limited: "Too many codes for this number today. Try again tomorrow, or message us.",
      busy: "We cannot send codes just now. Please try again in a little while.",
      offline: "You are offline. Connect, then try again.",
      unknown: "Something went wrong on our side. Please try again.",
    },
  },
  code: {
    back: "Back",
    title: "Enter the code",
    /**
     * The owner's neutral ruling on A3 (ADR 0030): the screen never says whether
     * the number has a booking. PLACEHOLDER wording; the design's is "Sent on
     * WhatsApp to {number}."
     */
    sentWhatsapp: (number: string) => `If ${number} has a booking with us, a code is on its way on WhatsApp.`,
    sentSms: (number: string) => `If ${number} has a booking with us, a code is on its way by SMS.`,
    label: "The six-digit code",
    /** Shown only for a code sent by SMS: WebOTP reads an SMS, and never a WhatsApp message. */
    automatic: "Read automatically where your phone allows",
    sms: "Send by SMS instead",
    resendIn: "Resend on WhatsApp in",
    resend: "Resend on WhatsApp",
    // PLACEHOLDER: said to a screen reader once, when the countdown runs out.
    canResend: "You can ask for a new code now.",
    submit: "Continue",
    noBooking: "No booking on this number?",
    /** The design's one line, "That code did not match. Two attempts left." */
    mismatch: (left: number) =>
      left === 0
        ? "That code did not match. It no longer works."
        : `That code did not match. ${ATTEMPTS[left] ?? `${String(left)} attempts left.`}`,
    // PLACEHOLDER: the design draws the void code, but not these words or the ones below.
    expired: "This code no longer works.",
    fresh: "Send a new code",
    failed: "That did not go through. Please try again.",
  },
  help: {
    back: "Back",
    // The design's title is "We have no booking on this number"; neutral, it becomes a question (ADR 0030).
    title: "No booking on this number?",
    body: "The app opens once a consultation is booked. The consultation is free.",
    hint: "Try the number you gave us, or message us and we will link it.",
    book: "Book a free consultation",
    message: "Message us",
  },
} as const;

const ATTEMPTS: Readonly<Record<number, string>> = {
  1: "One attempt left.",
  2: "Two attempts left.",
  3: "Three attempts left.",
  4: "Four attempts left.",
};

export const tabs = [
  { page: "/", label: "Home", icon: "home" },
  { page: "/visits", label: "Visits", icon: "visits" },
  { page: "/photos", label: "Photos", icon: "photos" },
  { page: "/payments", label: "Payments", icon: "payments" },
  { page: "/refer", label: "Refer", icon: "refer" },
] as const;

/** The three windows a visit is booked in (design/phase2/Client App, the windows data). */
export const WINDOW_NAMES = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;
export const WINDOW_HOURS = { morning: "9 am to 12 pm", afternoon: "12 to 4 pm", evening: "4 to 8 pm" } as const;
export type WindowLabel = keyof typeof WINDOW_NAMES;

/** "Afternoon, 12 to 4 pm", as a visit's card gives its window. */
export const windowText = (label: WindowLabel) => `${WINDOW_NAMES[label]}, ${WINDOW_HOURS[label]}`;

/** Each kind of visit, as the design names it. */
export const VISIT_TYPES = {
  consultation: "Consultation",
  first_fit: "First fit",
  service: "Service visit",
  replacement: "Replacement piece",
} as const;
// PLACEHOLDER: a visit whose FSM service item is none of the four.
export const OTHER_VISIT = "Visit";
// PLACEHOLDER: a consultation and fit in one visit, as the site and the technician's phone call it.
export const ONE_VISIT = "Consultation and fit";

/** A price's GST, beneath the amount charged once GST applies: "Rs. 30,000 + Rs. 5,400 GST". */
export const gstSplit = (exGst: string, gst: string) => `${exGst} + ${gst} GST`;

/**
 * While self-serve booking is off, booking, rescheduling and notes open WhatsApp to ops with a message ready
 * (docs/prompts/phase2-backend.md, "Booking"). PLACEHOLDER wording, all of it.
 */
export const messages = {
  reschedule: (what: string, date: string) => `I would like to move my ${what.toLowerCase()} on ${date}.`,
  note: (what: string, date: string) => `A note about my ${what.toLowerCase()} on ${date}: `,
  book: "I would like to book my next visit.",
  // PLACEHOLDER
  bookFirstFit: "I would like to book my first fit.",
  // PLACEHOLDER
  bookReplacement: "I would like to book my replacement piece.",
  document: (what: string, reference: string) => `Please send me the ${what.toLowerCase()} for ${reference}.`,
  // PLACEHOLDER: a visit's invoice that has not come in the day it should have.
  lateInvoice: (what: string, date: string) => `Please send me the invoice for my ${what.toLowerCase()} on ${date}.`,
  // PLACEHOLDER: a refund that has taken longer than Razorpay's working days.
  lateRefund: (what: string, date: string) => `My refund for ${what.toLowerCase()} from ${date} has not arrived.`,
} as const;

/** The booking sheet's words for a paid visit still being written to FSM, which Home repeats while it waits. */
const PAID_IN = "Your payment is in. We are booking your visit.";
const TOLD_WHEN_BOOKED = "We will message you on WhatsApp when the visit is booked.";

export const home = {
  /** The avatar's name begins with the initials it shows, so "tap RM" reaches it by voice. */
  profile: (initials: string) => `${initials}, your profile`,
  reschedule: "Reschedule",
  note: "Add a note",
  consultation: {
    label: "Your consultation",
    free: "Free",
  },
  /** Board B1's credit tile: "2 visit credits", with when the soonest expire. */
  credits: {
    count: (visits: number) => (visits === 1 ? "1 visit credit" : `${String(visits)} visit credits`),
    expire: (date: string) => `Expire ${date}`,
  },
  /**
   * Board B1's one prompt, and the invoice line beneath it (src/domain/home-prompt.ts). The replacement's line and
   * "See what that involves" are the board's own, and Visits' record words the line the same way. PLACEHOLDER:
   * everything else here.
   */
  prompt: {
    address: "Add your address, so your technician can find the door.",
    addAddress: "Add your address",
    /** PLACEHOLDER: "Your next service visit is due on Tue 27 Oct, in the morning." */
    nextVisit: (what: string, date: string, window: string | null) =>
      window === null
        ? `Your next ${what.toLowerCase()} is due on ${date}.`
        : `Your next ${what.toLowerCase()} is due on ${date}, in the ${window.toLowerCase()}.`,
    /** Once its due day has passed: "Your service visit was due on Thu 24 Sep." */
    wasDue: (what: string, date: string) => `Your ${what.toLowerCase()} was due on ${date}.`,
    /** PLACEHOLDER: the booking sheet, with the day and window chosen. */
    bookNext: "Book it for then",
    /** The booking sheet at the day offered, once the due day has passed: "Book it for Sat 3 Oct". */
    bookOn: (date: string) => `Book it for ${date}`,
    /** PLACEHOLDER: the booking sheet, at the replacement. */
    bookReplacement: "Book the replacement",
    involves: "See what that involves",
    invoice: (what: string, date: string) => `The invoice for your ${what.toLowerCase()} on ${date} is ready.`,
    openInvoice: "Open the invoice",
  },
  /** A visit FSM has not closed, once it has begun (LIFE-03). PLACEHOLDER: the design draws neither. */
  stages: { in_progress: "Today · in progress", done: "Done · notes on the way", closing: "Wrapping up" },
  next: {
    label: "Your next visit",
    length: (what: string, minutes: number) => `${what} · ${String(minutes)} minutes`,
    // PLACEHOLDER: the design draws no Home for a fitted client with nothing booked.
    none: "Nothing booked yet.",
    /** Board C1's button, which Home's card and Visits both show. */
    book: "Book your next visit",
    // PLACEHOLDER: a lead whose consultation is done.
    bookFirstFit: "Book your first fit",
    // PLACEHOLDER: a fitted client whose piece falls due before their next service would.
    bookReplacement: "Book your replacement piece",
    // PLACEHOLDER: the other kind of visit a fitted client may book, beside the one the app offers.
    orReplacement: "Or book a replacement piece",
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
   * A visit paid for, or booked free, that FSM does not have yet (docs/decisions/0095-a-booking-fsm-refuses-is-held.md):
   * the booking sheet's own words for a booking being written. PLACEHOLDER: the free line, and the design draws none.
   */
  beingBooked: {
    paid: PAID_IN,
    free: "We are booking your visit.",
    told: TOLD_WHEN_BOOKED,
  },
  // PLACEHOLDER: the design draws no Home for a client with nothing booked.
  nothing: {
    title: "Nothing booked",
    book: "Book a free consultation",
  },
} as const;

/**
 * PLACEHOLDER, every word: the page on what a replacement involves, which Home's prompt opens in place of a WhatsApp
 * message to us (docs/open-points.md, item 46; ADR 0086). No board draws it.
 */
export const replacement = {
  title: "What a replacement involves",
  back: "Back to Home",
  lines: [
    "A replacement takes off the piece you wear now and fits a new one in its place, at home, by your technician.",
    "The new piece is cut in and styled to match, as it was at your first fit.",
    "It is booked here like any other visit, and paid for when you book it.",
  ],
  book: "Book the replacement",
} as const;

export const visits = {
  title: "Visits",
  upcoming: "Upcoming",
  past: "Past",
  // PLACEHOLDER
  none: "Nothing booked yet.",
  /** Board C1: a visit paid for ahead, or covered by a credit. */
  prepaid: "Prepaid",
  // PLACEHOLDER: a visit that is not this client's, or no longer exists.
  notFound: "We could not find this visit.",
  // PLACEHOLDER: offline, the visits are not kept on the phone.
  offline: "Your visits will load when you are back online.",
  // PLACEHOLDER
  cancelled: "Cancelled",
  /*
   * PLACEHOLDER: the client's own record, derived from their visits and
   * payments (src/domain/client-history.ts). No board draws it. Board B1 writes
   * one sentence about a replacement, "Your replacement piece is due in
   * March.", and that sentence is kept word for word.
   *
   * A month and never a day: `syncPieces` works the date out afresh from FSM's
   * install date on every sync, so a day shown here could move under the client
   * who read it (ADR 0059). Nothing here is shown at all until there is
   * something true to say.
   */
  record: {
    label: "Your record",
    due: (month: string) => `Your replacement piece is due in ${month}.`,
    /** Past its month, the same fact in the tense it is now true in. */
    overdue: (month: string) => `Your replacement piece was due in ${month}.`,
    rows: { firstFit: "First fit", services: "Service visits", replacements: "Replacements", spend: "Total paid" },
    /** A client fitted before FSM held their visits has no first fit to name, which is not the same as none. */
    noFirstFit: "Not on record",
    /** Beside the total, so a figure that includes tax is not read as one that does not. */
    gst: "GST included",
  },
  detail: {
    back: "Back to visits",
    // PLACEHOLDER
    cancelled: "This visit was cancelled.",
    photographs: "Photographs from this visit",
    technician: "Technician",
    duration: "Duration",
    type: "Type",
    done: "What was done",
    /** The checklist the technician ticked, as one line, as board C9 writes it. */
    doneLine: (items: readonly string[]) => `${items.join(", ")}.`,
    /** The things a finished visit can say about its invoice (ADR 0056). */
    invoice: {
      open: "Tax invoice",
      newTab: "PDF, opens in a new tab",
      generating: "The invoice is still generating. Usually ready within the hour.",
      // PLACEHOLDER: a day after the visit, "within the hour" is no longer true.
      late: "The invoice is taking longer than it should. Message us and we will send it.",
      message: "Message us",
      // The owner's own words on 23 September 2026: a free visit says "No charge", and never promises a document.
      free: "No charge for this visit, so there is no invoice.",
      // PLACEHOLDER: an invoice held back on purpose: a credit visit's, and a draft whose total is not what the visit
      // was sold for, which is checked before it is sent.
      credit: "Paid with a free service visit. Your invoice will follow.",
      checking: "We are checking this invoice before we send it. Message us if you need it sooner.",
    },
    // PLACEHOLDER: the design draws no visit the client missed (LIFE-07), nor the dispute of its charge (ADR 0096).
    // The reason ops gave stays with them.
    noShow: {
      label: "Not home",
      line: (minutes: number) => `We came, and waited ${String(minutes)} minutes, but nobody was home.`,
      decision: {
        undecided: "We are looking at it. Nothing is charged until we have.",
        charged: "Charged.",
        waived: "Not charged.",
      },
      /** What the charge took, as the booking was sold to cost a no-show. */
      kept: (amount: string) => `Charged: we kept ${amount} of what you paid.`,
      creditSpent: "Charged: the visit credit it used is spent.",
      dispute: "Dispute this charge",
      disputed: {
        open: "You disputed this charge. We are looking at it.",
        refunded: "We looked at your dispute and refunded the charge.",
        upheld: "We looked at your dispute. The charge stands.",
      },
    },
  },
} as const;

/** Booking in the app (boards C2 to C6), while self-serve booking is on. */
export const booking = {
  step: (n: number, of: number) => `Step ${String(n)} of ${String(of)}`,
  /** How long a visit takes, as the choice of visit and the pay step say it: "3 hours", "1 hour 30 minutes". */
  length: (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const parts = [
      hours === 0 ? "" : `${String(hours)} ${hours === 1 ? "hour" : "hours"}`,
      rest === 0 ? "" : `${String(rest)} minutes`,
    ];
    return parts.filter((part) => part !== "").join(" ");
  },
  /**
   * PLACEHOLDER: no board draws it. With more than one service open to them, the client chooses first: every one
   * ops offer, a kind at a time, with how long it takes and what it costs (the owner's ruling of 27 September 2026,
   * docs/decisions/0085-services-ops-can-edit.md). There is no message to send for any other.
   */
  service: {
    title: "Pick a visit",
    /** A first fit's choice, which is only ever one of the hair systems ops offer. */
    titleFirstFit: "Choose your hair system",
    free: "Free",
    continue: "Continue",
  },
  /** PLACEHOLDER: no board draws it. A first fit while ops offer no hair system in the console. */
  firstFitNotYet: "First fits are not available to book yet.",
  /**
   * PLACEHOLDER: no board draws it. A client who has given no address is asked for it before any slot (ADR 0079;
   * ADR 0025, item 60), under Profile's heading, "Where we come".
   */
  address: {
    why: "Your address first, so we know where to come. Then pick a date.",
    refused: "We need your address before we can hold a slot. Add it, then pick your window again.",
    save: "Save and continue",
  },
  date: {
    title: "Pick a date",
    available: "Available",
    full: "Full",
    continue: "Continue",
    // PLACEHOLDER: no board draws the day offered being full, nor the days past the first fortnight.
    offeredFull: (day: string) => `${day} is full. We have picked the next open day.`,
    offeredFullPickAnother: (day: string) => `${day} is full. Pick another day.`,
    later: "Later dates",
    laterFailed: "Those dates did not load. Please try again.",
  },
  window: {
    title: "Pick a window",
    full: "Full",
    withRegular: (name: string) => `With ${name}`,
    another: "Another technician",
    regularLine: (name: string) => `${name}, your regular technician, is free.`,
    // PLACEHOLDER: the design draws the window step with the regular technician free.
    anotherLine: (name: string) => `${name} is not free then. Another technician will come.`,
    continue: "Continue to payment",
    // PLACEHOLDER
    taken: "That window has just gone. Pick another.",
  },
  pay: {
    title: "Pay and confirm",
    held: (time: string) => `Slot held ${time}`,
    freeUntil: (when: string) => `Free to move until ${when}. After that it is charged.`,
    // PLACEHOLDER: a booking ops set to cost nothing when changed late (docs/decisions/0088-every-policy-in-the-console.md).
    freeAnyTime: "Free to move or cancel at any time.",
    pay: (amount: string) => `Pay ${amount}`,
    neverHandlesMoney: (name: string) => `${name} never handles money.`,
    guarantee: GUARANTEE,
    // PLACEHOLDER: a free consultation has no payment; the design draws the credit board's button.
    free: "Free",
    confirm: "Confirm visit",
    // Board C5: a service-visit credit covers it.
    credit: {
      zero: "Rs. 0",
      used: "1 visit credit used",
      remaining: (left: number) => `${String(left)} remaining`,
      /** The notice the hold is sold under, which ops set: 24 hours to begin with. */
      note: (hours: number) => `Cancel inside ${String(hours)} hours and the credit is gone.`,
    },
    /**
     * PLACEHOLDER: the design never asks. Ticked, it records the client's yes to WhatsApp about their
     * visits (the purpose the day-before reminder is sent under), on a notice of this line alone.
     */
    remind: "Remind me on WhatsApp the day before",
    /**
     * PLACEHOLDER: no board draws them. Booking a visit also agrees to the photograph purposes the client has never
     * decided on, one tap away beneath Pay. With the referral card's lines (profile.referralCards), they are the
     * notice each consent is recorded under, word for word (src/config/notices.ts; booking/consents.ts).
     */
    consents: {
      open: "What booking agrees to",
      both: "By booking this visit, you also agree to photographs taken for your visit record and used on referral cards.",
      alone: {
        photos_own_record: "By booking this visit, you also agree to photographs taken for your visit record.",
        photos_referral_cards: "By booking this visit, you also agree to photographs on referral cards.",
      },
      switchEither: "You can switch either off in Profile.",
      switchIt: "You can switch it off in Profile.",
    },
    /**
     * PLACEHOLDER, every line: no board draws a discount code (docs/decisions/0108-discount-codes.md).
     * A code that does not apply is told only that, whatever the reason.
     */
    code: {
      open: "Have a discount code?",
      label: "Discount code",
      apply: "Apply",
      applying: "Applying",
      /** "Code TENOFF: Rs. 236 off", beneath the price: what it takes off the price shown, GST included. */
      applied: (code: string, off: string) => `Code ${code}: ${off} off`,
      remove: "Remove code",
      removing: "Removing",
      errors: {
        code_not_applicable: "That code does not apply to this visit.",
        rate_limited: "Too many codes tried. Try again tomorrow.",
        already_discounted: "This visit already has a code.",
        price_settled: "Payment has started, so the code can no longer change.",
        hold_expired: "Your slot hold has run out. Pick a window again.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Try again.",
      } as Readonly<Record<string, string>>,
    },
  },
  /**
   * Board C5's late-fee line, which C7 repeats word for word: the amount charged, and its GST split after it,
   * muted, once GST applies.
   */
  lateFee: {
    /** The notice is the one the visit is sold under, which ops set: 24 hours to begin with. */
    costs: (amount: string, hours: number) => `Moving inside ${String(hours)} hours costs ${amount}`,
    split: (split: string) => ` (${split})`,
    rest: ". The balance carries over.",
  },
  // PLACEHOLDER: said to a screen reader, once, a minute before the hold lapses.
  lastMinute: "One minute left to pay. Then the slot goes back.",
  failed: {
    label: "Payment failed",
    title: "The payment did not go through.",
    held: (time: string) => `Slot held ${time} more.`,
    retry: "Try again",
  },
  expired: {
    label: "Hold expired",
    title: "That slot has gone back.",
    pickAgain: "Pick again",
  },
  confirmed: {
    label: "Confirmed",
    tellsYou: (name: string) => `${name} messages you the day before.`,
    paid: "Paid",
    note: (name: string) => `Add a note for ${name}`,
    // PLACEHOLDER from here to the end.
    close: "Done",
  },
  confirming: "Confirming your visit.",
  // PLACEHOLDER: the hold's time ran out on the phone after Razorpay had taken the payment, which keeps it.
  paidIn: PAID_IN,
  slow: `This is taking longer than usual. ${TOLD_WHEN_BOOKED}`,
  refunded: "We could not book that visit, so your payment is being refunded in full.",
  failedToStart: "That did not go through. Please try again.",
  creditGone: "Your visit credit is already on another booking, so this visit is charged at the price below.",
  close: "Close",
} as const;

/**
 * A note on a visit to come, kept on it for the technician's card (REQ-04). PLACEHOLDER: the design draws the
 * "Add a note" button and no sheet behind it.
 */
export const note = {
  title: (technician: string | null) =>
    technician === null ? "Add a note for your technician" : `Add a note for ${technician}`,
  label: "What should they know at the door?",
  offline: "No connection. Your note stays here until you are back online.",
  save: "Save the note",
  saving: "Saving",
  saved: (technician: string | null) =>
    technician === null
      ? "Saved. Your technician reads it before your visit."
      : `Saved. ${technician} reads it before your visit.`,
  withOps: "Notes go to us on WhatsApp just now.",
  failed: "That did not go through.",
  whatsapp: "Send it on WhatsApp",
};

/**
 * PLACEHOLDER: disputing a no-show's charge, which no board draws (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md),
 * in the note sheet's frame.
 */
export const dispute = {
  title: "Dispute this charge",
  label: "Why is the charge wrong?",
  send: "Send",
  sending: "Sending",
  sent: "We have your dispute. We will look at it and tell you what we decide.",
  already: "You have disputed this charge already. We will tell you what we decide.",
  closed: "The days to dispute this charge have passed. If something is wrong, message us.",
  failed: "That did not go through. Please try again.",
  tryAgain: "Try again",
};

/**
 * Moving or cancelling a visit (boards C7 and C8; docs/decisions/0046-moving-and-cancelling.md). The consequence
 * shows before the client confirms. The design writes refunds as "three to five working days"; the owner ruled
 * the app says 5 to 7 (ADR 0025, item 28).
 */
export const change = {
  visit: (weekday: string) => `${weekday}'s visit`,
  move: {
    title: (visit: string) => `Move ${visit}`,
    free: (amount: string) => `Free to move. Your ${amount} carries over.`,
    charged: (amount: string) => `Charged. The ${amount} is not refunded and the new visit is paid separately.`,
    pick: "Pick a new date",
    accept: "Move and accept charge",
    keep: "Keep it",
    // PLACEHOLDER from here to the end of move: nothing paid, and the way to C8, which the design draws but does
    // not reach. A late fee's line is board C5's (booking.lateFee).
    freeNothingPaid: "Free to move.",
    cancelInstead: "Cancel the visit instead",
    creditCharged: "Charged. The credit is not returned and the new visit is paid separately.",
  },
  cancel: {
    title: (visit: string) => `Cancel ${visit}`,
    refund: (amount: string, destination: string) => `${amount} back to your ${destination} in 5 to 7 working days.`,
    confirm: "Cancel visit",
    keep: "Keep it",
    // PLACEHOLDER from here to the end of cancel.
    lessFee: (fee: string, amount: string, destination: string) =>
      `The late fee of ${fee} is kept. ${amount} back to your ${destination} in 5 to 7 working days.`,
    charged: (amount: string) => `Charged. The ${amount} is not refunded.`,
    nothingPaid: "Nothing was paid, so nothing is charged.",
    accept: "Cancel and accept charge",
    creditBack: "Your credit comes back.",
    // Board C8, inside 24 hours, for a credit booking.
    creditUsed: (left: string | null, expiry: string) =>
      left === null ? "Your credit is used." : `Your credit is used. ${left} left, expiring ${expiry}.`,
    acceptCredit: "Cancel and use credit",
    done: "Cancelled",
    doneLine: (visit: string) => `${visit} is cancelled.`,
    close: "Done",
  },
  // PLACEHOLDER: what came of a change that did not go through.
  termsChanged: "The free change has just run out. This is what it costs now.",
  notChangeable: "This visit can no longer be changed here.",
  message: "Message us",
  failed: "That did not go through, and nothing has changed. Please try again.",
  moved: "Moved",
  moveItem: (what: string) => `${what} · moved`,
  lateFeeItem: (what: string) => `Late fee · ${what.toLowerCase()}`,
  confirmMove: "Confirm the move",
  destination: "UPI",
} as const;

/** What a referral earns each side, as ops set it in the console (docs/decisions/0107-referral-rewards-in-the-console.md). */
interface Reward {
  readonly referrer_visits: number;
  readonly friend_visits: number;
}

/** "1 service visit", "3 service visits". */
const serviceVisits = (count: number): string => (count === 1 ? "1 service visit" : `${String(count)} service visits`);

/**
 * Board F1's promise, from the referrer's side. With both at 3 it is the board's; the words for unequal sides, for 0
 * and for a reward not known, which gives no count, are PLACEHOLDER, pending the owner's (docs/open-points.md, item 172).
 */
function promiseOf(reward: Reward | null): string {
  const fitted = "When a friend you refer is fitted,";
  if (reward === null) return `${fitted} we tell you.`;
  const { referrer_visits: mine, friend_visits: theirs } = reward;
  if (mine === 0 && theirs === 0) return `${fitted} we tell you.`;
  if (mine === 0) return `${fitted} they get ${serviceVisits(theirs)} free.`;
  if (theirs === mine) return `${fitted} you both get ${serviceVisits(mine)} free.`;
  if (theirs === 0) return `${fitted} you get ${serviceVisits(mine)} free.`;
  return `${fitted} you get ${serviceVisits(mine)} free, and your friend gets ${String(theirs)}.`;
}

/** Refer (boards F1 to F6): the invite, the card behind it, and who has been fitted. */
export const refer = {
  title: "Refer",
  promise: promiseOf,
  credit: { label: "Your credit", expire: (date: string) => `Expire ${date}` },
  // PLACEHOLDER: the board draws no line for the credits of the invite a client came with while ops review them.
  inviteCredits: {
    checking: "The service visits from the invite you came with are being checked. We will message you.",
    refused: "We could not give the service visits from the invite you came with. Message us to know why.",
  },
  noOther: "No other discount applies.",
  share: "Share an invite",
  tracker: "See who has been fitted",
  card: {
    title: "Which card?",
    what: "This is what he sees in the chat. No name on it, and no copy.",
    mine: { name: "My before and after", note: "Your own photographs" },
    house: { name: "A Mane Man example", note: "Our house sample" },
    next: "Continue to share",
  },
  consent: {
    title: "Before you send your own photographs",
    allow: "Allow for referral cards",
    instead: "Use the example instead",
  },
  /**
   * Board F4: the chat's preview, exactly as the friend receives it. Its heading and line are the landing's own
   * preview (site/src/content/referral.ts), which test/node/app-invite-preview.test.ts holds them to, so the
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
      return `Home-fitted hair systems across Delhi NCR. ${serviceVisits(friend)} free when you're fitted.`;
    },
    domain: "maneman.in",
    message: (link: string) => `Had my hair system fitted at home by these people. Worth a look — ${link}`,
    via: "Share via",
    whatsapp: "WhatsApp",
    other: "Other apps",
    copy: "Copy link",
    copied: "Link copied",
    /** Board F6's share failure, and its way on. */
    failed: {
      label: "Share failed",
      line: "The link did not generate. Nothing was sent.",
      retry: "Try again",
    },
  },
  fitted: {
    title: "Who has been fitted",
    /** Board F5's two figures, each above its word. */
    earned: "visits earned",
    remaining: "remaining",
    // PLACEHOLDER: a friend fitted before the grant kept first names, and erased since; never the erasure's word.
    unnamed: "A friend",
    when: (month: string) => `Fitted ${month}`,
    each: (visits: number) => (visits === 1 ? "1 visit earned" : `${String(visits)} visits earned`),
    only: "Friends show here once they're fitted.",
    none: "Nobody you have referred has been fitted yet.",
    back: "Back to refer",
  },
  revoke: {
    open: "Revoke the photo card",
    title: "Switch off your photographs?",
    body: "New opens show the house example. Cards already sent stay in those chats.",
    yes: "Switch off",
    no: "Keep it on",
    // PLACEHOLDER: a revoke the API did not answer leaves the card as it was.
    failed: "That did not go through, and your photographs are still on the card. Please try again.",
  },
  // PLACEHOLDER: the card is composed on the phone; the design does not draw its waiting or its failures.
  composing: "Making your card.",
  cardFailed: "We could not make your card. The house example is used instead.",
  /** Consent or the example did not go through: nothing changed, and nothing was shared. */
  notChanged: "That did not go through, so nothing has changed. Please try again.",
  close: "Close",
} as const;

export const photos = {
  title: "Photos",
  compare: "Compare",
  angles: { front: "Front", top: "Top", left: "Left", right: "Right", hair: "Hair" },
  /** The compare's three angles, as board D2 names them. */
  compareAngles: { front: "Front", top: "Top", hair: "Hairline" },
  // PLACEHOLDER: a photograph's description for a screen reader; the design draws no captions.
  alt: (angle: string, phase: "before" | "after", date: string) => `${angle}, ${phase} the visit, ${date}`,
  back: "Back to photos",
  from: "From",
  to: "To",
  // PLACEHOLDER: the divider's name for a screen reader, what its place shows, and the compare opened with fewer
  // than two visits.
  divider: "Divider between the two photographs",
  dividerAt: (percent: number, from: string, to: string) =>
    `${String(percent)}% of ${from} on the left, ${String(100 - percent)}% of ${to} on the right`,
  compareNone: "Compare opens once two visits have photographs.",
  download: "Download",
  downloaded: "Downloaded photographs sit in your gallery, outside the app.",
  photoOf: (angle: string, date: string) => `${angle} · ${date}`,
  // PLACEHOLDER
  close: "Close",
  // PLACEHOLDER: no board draws the try-on the client made on the site (ADR 0025, items 63 and 65; ADR 0082 and 0084).
  tryOn: {
    title: "Your try-on",
    images: { photo: "Your photograph", look: "Your look" },
    alt: (image: string, date: string) => `${image}, try-on of ${date}`,
    // How long each is kept: the photograph an hour after the look was asked for, the look the days the site keeps it.
    keptBoth: (photoUntil: string, lookUntil: string) =>
      `Your photograph is kept until ${photoUntil}, the look until ${lookUntil}.`,
    keptLook: (lookUntil: string) =>
      `Your photograph was deleted within the hour. The look is kept until ${lookUntil}.`,
    keptPhoto: (photoUntil: string) => `The look is still being made. Your photograph is kept until ${photoUntil}.`,
    // The small copy of the photograph is held as long as the look, until the client books (ADR 0084).
    keptTogether: (until: string) => `Your photograph and the look are kept until ${until}.`,
    // A client's try-on, once they have booked (ADR 0084): the photograph for good, the look until the first fit.
    photoKept: "Your photograph is kept in your account until you ask us to delete it.",
    lookKeptToFirstFit: "The look is kept until your first fit is photographed.",
    lookKeptUntil: (lookUntil: string) => `The look is kept until ${lookUntil}.`,
  },
} as const;

export const payments = {
  title: "Payments",
  back: "Back to payments",
  // PLACEHOLDER: an entry that paid for no visit we know of.
  payment: "Payment",
  refund: "Refund",
  /** A refund as a WhatsApp asking for its voucher names it: "service visit refund on 2 Sep 2030". */
  refundOf: (what: string) => `${what} refund`,
  /** A refund's figure: money coming back, never another charge. */
  moneyBack: (amount: string) => `+ ${amount}`,
  backTo: (method: string) => `back to your ${method}`,
  // PLACEHOLDER: a late fee's name, and a charge's row; the evidence is the design's ("cancelled 9:14 am, visit
  // was 10 am"), with the dates when the two fall on different days.
  lateFeeOf: (what: string) => `${what} · late fee`,
  charge: "Charge",
  charged: "Charged",
  evidence: (change: "cancelled" | "moved", at: string, visit: string) => `${change} ${at}, visit was ${visit}`,
  // PLACEHOLDER: the design draws no visit the client was not home for (LIFE-07).
  noShow: {
    meta: (note: { waited_minutes: number }) => `not home, we waited ${String(note.waited_minutes)} min`,
    label: "Not home",
    decision: { undecided: "under review", charged: "charged", waived: "not charged" },
    fact: (minutes: number, decision: string) => `We waited ${String(minutes)} minutes · ${decision}`,
  },
  // PLACEHOLDER: the design draws no discount code on a payment (docs/decisions/0108-discount-codes.md).
  discount: {
    label: "Discount code",
    /** "AUDTEST: Rs. 1,000 off", before GST; the code alone where what it took off is not known. */
    fact: (code: string, off: string | null) => (off === null ? code : `${code}: ${off} off`),
  },
  /**
   * The service-visit credits among the payments (LIFE-14). Board E1 draws a visit a credit covered: "Service
   * visit · 25 Jul · visit credit · Covered by credit · Rs. 0 · 1 credit used". PLACEHOLDER: every other line.
   */
  credits: {
    title: "Visit credits",
    meta: {
      used: "visit credit",
      lost: "cancelled late",
      returned: "cancelled in time",
      expired: "past their date",
      withdrawn: "the fit was refunded",
      corrected: "corrected by us",
      added: "added",
    },
    from: { referral: "a friend you invited was fitted", ops: "from us", import: "carried over" },
    status: {
      used: "Covered by credit",
      lost: "Credit lost",
      returned: "Credit returned",
      expired: "Credits expired",
      withdrawn: "Credits withdrawn",
      corrected: "Credits corrected",
      added: "Credits added",
    },
    count: (event: string, visits: number) => {
      const credits = `${String(visits)} ${visits === 1 ? "credit" : "credits"}`;
      if (event === "used") return `${credits} used`;
      if (event === "lost") return `${credits} lost`;
      if (event === "returned") return `${credits} back`;
      return credits;
    },
  },
  /** A payment's status, and a refund's. */
  status: {
    captured: "Paid",
    // PLACEHOLDER from here to the refund's "created", and its "processed" and "failed".
    authorized: "Processing",
    refunded: "Refunded",
    partially_refunded: "Partly refunded",
    created: "Refund processing",
    processed: "Refunded",
    failed: "Refund failed",
  },
  /**
   * How long a refund takes, beside "Refund processing". The design says "3 to 5 working days"; Razorpay's
   * normal refunds take 5 to 7, and the owner ruled the app says so (ADR 0025, item 28).
   */
  speed: { normal: "5 to 7 working days" } as Readonly<Record<string, string>>,
  // PLACEHOLDER: a refund still processing after Razorpay's working days, which the client should hear about.
  lateRefund: "Refund processing · taking longer than it should",
  message: "Message us",
  // PLACEHOLDER: an entry that is not this client's, or no longer exists.
  notFound: "We could not find this payment.",
  /** A method as a list's meta line writes it ("22 Aug · UPI"), and as the detail's row does ("UPI"). */
  methods: {
    upi: ["UPI", "UPI"],
    card: ["card", "Card"],
    netbanking: ["net banking", "Net banking"],
    wallet: ["wallet", "Wallet"],
    emi: ["EMI", "EMI"],
    paylater: ["pay later", "Pay later"],
  } as Readonly<Record<string, readonly [string, string]>>,
  // PLACEHOLDER: the design draws a payment's rows; a refund's "Refunded to" and "For" are ours.
  rows: {
    date: "Date",
    method: "Method",
    destination: "Refunded to",
    status: "Status",
    reference: "Reference",
    for: "For",
  },
  documents: "Tax documents",
  invoice: "Tax invoice",
  /** Said to a screen reader only, since a document opens outside the app. */
  newTab: "PDF, opens in a new tab",
  receipt: "Receipt",
  // PLACEHOLDER
  voucher: "Refund voucher",
  /**
   * Board E3's line for a document not yet raised. An invoice is raised once the visit is done, so what it says
   * depends on when that was (ADR 0056). PLACEHOLDER: every line but the invoice's first.
   */
  unavailable: {
    invoice: "The invoice is still generating. Usually ready within the hour.",
    invoiceAfterVisit: "The tax invoice is raised once the visit is done.",
    invoiceLate: "The invoice is taking longer than it should.",
    // PLACEHOLDER: receipts and vouchers wait for the invoicing route (docs/open-points.md, item 3).
    receipt: "The receipt is not ready yet.",
    voucher: "The refund voucher is not ready yet.",
    notify: "Ask us for it",
  },
} as const;

export const empty = {
  photos: {
    title: "Photos",
    lines: ["Your photographs start at your first fit.", "Five angles, before and after each visit."],
  },
  payments: {
    title: "Payments",
    lines: ["Nothing to pay yet.", "Your consultation is free. Later payments appear here with their invoices."],
  },
  // PLACEHOLDER: the design draws the empty list for a lead only.
  paymentsFitted: {
    title: "Payments",
    lines: ["No payments yet.", "Payments made in the app appear here with their invoices."],
  },
  refer: {
    title: "Refer",
    lines: (reward: Reward | null): readonly [string, string] => [
      "Nobody you have referred has been fitted yet.",
      promiseOf(reward),
    ],
  },
} as const;

export const profile = {
  back: "Back",
  where: "Where we come",
  editAddress: "Edit address and access notes",
  // PLACEHOLDER: the design draws the profile with an address already given, and no form.
  noAddress: "No address yet. Add it before you book.",
  addAddress: "Add your address and access notes",
  // PLACEHOLDER: the design draws no landmark line (ADR 0054).
  near: (landmark: string) => `Near ${landmark}`,
  // PLACEHOLDER: an address the client gave ops on the phone, which ops saved for them (ADR 0092).
  givenToOps: (date: string) =>
    `You gave us this address on the phone on ${date}. If anything is wrong, change it here.`,
  form: {
    // PLACEHOLDER: the design draws no address form at all, so none of the
    // building search's words are drawn either (ADR 0054). The search is an
    // addition to the form and never a gate: every field below still works
    // typed, and an address with no building chosen saves without a pin.
    building: {
      label: "Search for your building",
      hint: "Start typing your building or society. Choose it to help your technician find you.",
      unavailable: "Search is unavailable just now. Type your address below instead.",
      found: (count: number) => (count === 1 ? "1 building found" : `${String(count)} buildings found`),
      // Google asks for their name against suggestions shown without a map.
      attribution: "Google Maps",
    },
    flat: "Flat or house number",
    floor: "Floor (optional)",
    tower: "Tower or block (optional)",
    landmark: "Landmark (optional)",
    // The flat is asked for on its own above, so this line is the building or the street the house is on.
    line1: "Building, society or street",
    line2: "Street (optional)",
    locality: "Sector or area",
    city: "City",
    pincode: "Pincode",
    accessNotes: "Access notes (optional)",
    accessHint: "A gate code, or where to park. Your technician sees it the day before the visit.",
    save: "Save",
    cancel: "Cancel",
    invalid: "Fill in the flat or house number, the building or street, the area, the city and a six-digit pincode.",
  },
  agreed: "What you have agreed to",
  purposes: {
    photos_own_record: "Photographs taken for your visit record",
    photos_referral_cards: "Photographs on referral cards",
    photos_marketing: "Photographs in our marketing",
    whatsapp_visits: "WhatsApp about your visits",
    // PLACEHOLDER: the design's profile lists four; the fifth is the waitlist's launch alert.
    whatsapp_launches: "WhatsApp about launches",
  },
  given: (date: string) => `Given ${date}`,
  notGiven: "Not given",
  // PLACEHOLDER: what switching off visit messages means, since ops then call instead.
  visitsOff: "No visit updates on WhatsApp. We will call you about any change.",
  // PLACEHOLDER: a switch the API did not answer stays as it was.
  switchFailed: "That did not go through, so nothing has changed. Please try again.",
  /**
   * The four lines the design shows before a card is turned on (F3), and the naming line the owner ruled beside
   * them; the consent's notice carries them all.
   */
  referralCards: {
    lines: [
      "Anyone you send this card to can see your photographs.",
      "They can forward it, and so can anyone who receives it.",
      "You can switch it off at any time, and new opens will show our house example instead.",
      "Cards already delivered stay in people’s chats. We cannot take those back.",
      // The owner's ruling: a referrer is named on their invite only after reading this (ADR 0025, item 24).
      "Your first name appears on your invite.",
    ],
    // PLACEHOLDER
    confirm: "Switch on",
    cancel: "Keep it off",
  },
  change: {
    label: "Change mobile number",
    body: "A code goes to both numbers, then we confirm with you before it takes effect.",
    prefix: "+91",
    placeholder: "New number",
    start: "Start the change",
    // PLACEHOLDER from here: the design draws the start only.
    invalid: "Enter a ten-digit mobile number, not the one you use now.",
    codes: "Enter the code sent to each number.",
    oldCode: "Code sent to your current number",
    newCode: (number: string) => `Code sent to ${number}`,
    check: "Check the codes",
    proven: "Code accepted.",
    waiting: (number: string) => `We will confirm the change to ${number} with you, then it takes effect.`,
    withdraw: "Withdraw this change",
    failed: "That did not go through. Please try again.",
    limited: "You have started three changes today. Please try again tomorrow.",
    // What ops decided about the last change, for 30 days after (OPS-09). The reason is ops' own words.
    confirmed: (number: string, date: string) => `Your number was changed to ${number} on ${date}.`,
    rejected: (number: string, date: string) => `On ${date} we did not change your number to ${number}.`,
    why: (reason: string) => `Our reason: ${reason}`,
  },
  support: {
    label: "Support",
    message: "Message us on WhatsApp",
    hint: "Replies within a working day. Everything in writing.",
  },
  // PLACEHOLDER: the design has no card for the client's rights over their data (docs/decisions/0049-dpdp.md).
  data: {
    label: "Your data",
    body: "Download a copy of everything we hold about you, or raise a concern about how we use it.",
    download: "Download my data",
    raise: "Raise a concern",
    field: "Your concern",
    send: "Send",
    cancel: "Not now",
    // Beside support's "Replies within a working day": the 30 days is the most a concern can take, not the usual.
    sent: "Received. We reply on WhatsApp, usually within a working day and within 30 days at the latest.",
    failed: "That did not go through. Please try again.",
  },
  deletion: {
    label: "Delete your account",
    body: "Photographs deleted within seven days. Invoices kept eight years, by law.",
    request: "Request deletion",
    // PLACEHOLDER: the design draws the button only.
    confirm: "Ask us to delete your account? We will confirm on WhatsApp before anything is deleted.",
    yes: "Yes, request deletion",
    no: "Keep my account",
    requested: (date: string) => `Deletion requested on ${date}. We will confirm on WhatsApp.`,
    failed: "That did not go through, so nothing has been requested. Please try again.",
  },
  // PLACEHOLDER: the design has no logout; it ends the session on this device.
  logout: "Log out",
  // PLACEHOLDER: only the API can end the session, so a logout it did not answer leaves the client logged in.
  logoutFailed: "That did not go through, so you are still logged in here. Please try again.",
} as const;

/** Board B3: loading, offline and error. */
export const states = {
  loading: "Loading",
  /** On Home, which the phone keeps. */
  offline: "No connection. Showing your last update.",
  // PLACEHOLDER: on a page the phone does not keep.
  offlineOnly: "No connection.",
  waiting: "This page will load when you are back online.",
  error: {
    title: "We could not load your visit.",
    /** Said only when the phone has kept a Home with a visit on it. */
    booked: "Your visit is still booked.",
    retry: "Try again",
    message: "Message us",
  },
} as const;

export const errors = {
  // PLACEHOLDER: the design draws no error for the profile.
  load: "We could not load this. Please try again.",
  retry: "Try again",
} as const;

/** A page that failed to draw, which React would otherwise leave blank. */
export const broken = {
  // PLACEHOLDER: the design draws no page that failed.
  message: "This page did not open.",
  reload: "Reload",
  home: "Home",
} as const;

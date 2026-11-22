// Booking and changing a visit: the sheet's steps, a note to the technician, a dispute.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { visitLength } from "./common.ts";
import { PAID_IN, TOLD_WHEN_BOOKED } from "./home.ts";
import { REFUND_TAKES } from "./payments.ts";
import { VISIT_PHOTOS } from "./profile.ts";

/** Booking in the app, while self-serve booking is on. */
export const booking = {
  step: (n: number, of: number) => `Step ${String(n)} of ${String(of)}`,
  /** How long a visit takes, as the choice of visit and the pay step say it. */
  length: visitLength,
  /**
   * With more than one service open to them, the client chooses first: every one
   * ops offer, a kind at a time, with how long it takes and what it costs
   * (docs/decisions/0085-services-ops-can-edit.md). There is no message to send for any other.
   */
  service: {
    title: "Pick a visit",
    /** A first fit's choice, which is only ever one of the hair systems ops offer. */
    titleFirstFit: "Choose your hair system",
    free: "Free",
    continue: "Continue",
  },
  /**
   * A replacement's choice of hair system (design/client-redesign, "Choose your next hair system"; ADR 0253): keep the
   * one worn or change its base, each marked by how it compares, with what the change means beneath.
   */
  tier: {
    head: "Book your replacement",
    title: "Choose your next hair system",
    /** "Your Mane Man Active hair system is due on 6 Dec. Keep it or change the base." */
    due: (worn: string, date: string) => `Your ${worn} hair system is due on ${date}. Keep it or change the base.`,
    /** Once its day has passed: a replacement may still be booked. */
    wasDue: (worn: string, date: string) => `Your ${worn} hair system was due on ${date}. Keep it or change the base.`,
    /** Under Choose a date, until one is chosen. */
    missing: "Choose a hair system first.",
    keep: "Keep it",
    upgrade: "Upgrade",
    downgrade: "Downgrade",
    change: "Switch",
    /** "Upgrade from Mane Man Active to Mane Man Natural". */
    from: (how: string, worn: string, chosen: string) => `${how} from ${worn} to ${chosen}`,
    /** "Rs. 18,000 with its fitting, lasts 6 months." */
    costs: (amount: string, months: number) => `${amount} with its fitting, lasts ${String(months)} months.`,
    serviceStays: (amount: string, every: string) => `Service stays ${amount} ${every}.`,
    serviceChanges: (was: string, wasEvery: string, now: string, nowEvery: string) =>
      `Service changes from ${was} ${wasEvery} to ${now} ${nowEvery}, from your first service after the fitting.`,
    /** The old package's hair system is stock, for any client it fits, and nobody pays for it. */
    oldBack: (worn: string) => `Any ${worn} hair system ordered for you goes back to stock, at no cost to you.`,
    carries: "Your colour, density and hairline carry over.",
    ask: "Not sure? Ask us",
    /** The WhatsApp message "Ask us" opens with. */
    asking: "I’d like help choosing my next hair system.",
    next: "Choose a date",
  },
  /** A first fit while ops offer no hair system in the console. */
  firstFitNotYet: "First fits aren’t open to book yet.",
  /**
   * A paid visit ops book with the client on WhatsApp: what it costs, and that they say how to pay, which differs with
   * whether online payment is on (ADR 0209, ADR 0272).
   */
  withOps: (price: string) => `We book it with you on WhatsApp, and tell you how to pay ${price}.`,
  /** Request mode (design/client-redesign, "Ask for a time"): while booking with ops, the pick goes to them on WhatsApp. */
  request: {
    title: "Ask for a time",
    lede: "Pick a day and the part of the day that suits you. We confirm the time on WhatsApp.",
    day: "Day",
    part: "Time of day",
    note: "Nothing is held or paid until we confirm.",
    send: "Send request",
    /** WhatsApp opens with the request written in; it reaches ops once the client sends it there. */
    opening: "Opening WhatsApp",
  },
  /**
   * What the WhatsApp message asks for: the visit, the day and window the app offered, who, and the hair system:
   * "I’d like to book my replacement: Fri 16 Oct, morning. Arjun Mehta, Mane Man Active."
   */
  asking: (
    message: string,
    visit: { day: string | null; window: string | null; name: string; what: string | null },
  ) => {
    const when = [visit.day, visit.window].filter((part) => part !== null).join(", ");
    const who = [visit.name, visit.what].filter((part) => part !== null && part !== "").join(", ");
    return `${message}${when === "" ? "" : `: ${when}`}.${who === "" ? "" : ` ${who}.`}`;
  },
  /**
   * A client who has given no address is asked for it before any slot (ADR 0079;
   * ADR 0025, item 60), under Profile's heading, "Your address".
   */
  address: {
    why: "First, your address. Then pick a time.",
    refused: "Add your address, then pick a time again.",
    save: "Save and continue",
  },
  /** The client's address is in a pincode we do not come to, so no day is offered. */
  notServed: {
    line: (pincode: string) => `We don’t come to ${pincode} yet.`,
    body: "Change your address below, or join the waitlist and we’ll tell you when we arrive.",
    waitlist: "Join the waitlist",
  },
  /** A fit whose hair system no stock code is made to the client's size: ops order it and book it on WhatsApp. */
  madeToOrder: {
    title: "Made to order in your size",
    /** Once ops have the ask. */
    ordering: "We’ll order it in your size and message you on WhatsApp to book your fitting.",
    /** Where the ask could not reach us: the client asks on WhatsApp instead. */
    line: "Ask us and we’ll order it, then message you to book your fitting.",
    ask: "Ask us on WhatsApp",
    done: "Done",
    questions: "Questions? Ask us",
    /** The WhatsApp message "Ask us" opens with: "Please order my Mane Man Essential replacement in my size." */
    asking: (visit: string | null) => `Please order my ${visit ?? "hair system"} in my size.`,
    /** The WhatsApp message "Questions? Ask us" opens with, once ops have the ask. */
    about: (visit: string | null) => `About my ${visit ?? "hair system"} made to order: `,
  },
  /**
   * The day and the time on it, on one screen (design/client-redesign, "Pick a time"): the earliest open time to take
   * at a tap, the days in a row that scrolls, each with how many times are left, then the day's times under its
   * parts.
   */
  when: {
    title: "Pick a time",
    /** A first fit's and a replacement's, as the design titles them. */
    titleDate: "Pick a date",
    titleMove: "Move your visit",
    /** "Earliest: Tue 18 Nov, 9:30 am" */
    earliest: (day: string, time: string) => `Earliest: ${day}, ${time}`,
    tapToChoose: "Tap to choose it",
    /** Beneath a day's figure: how many of its times are open. */
    left: (count: number) => `${String(count)} left`,
    full: "Full",
    /** Beside a part of the day: how many of its times are open. */
    open: (count: number) => `${String(count)} open`,
    fullyBooked: "Fully booked",
    // Our words: the design marks no time; under the day's times that cost least.
    recommended: "Recommended",
    /** Read after a time struck through. */
    taken: "taken",
    /** The promise of any time picked, whoever comes. */
    arrival: (minutes: number) =>
      `The technician arrives within ${String(minutes)} minutes of the time you pick. We assign the technician.`,
    /** Above Continue, once a time is picked: "Tue 18 Nov, arrives 9:30–10 am". */
    summary: (day: string, hours: string) => `${day}, arrives ${hours}`,
    // A time already inside the notice.
    within: (hours: number) => `Within ${String(hours)} hours: changes are charged`,
    continue: "Continue",
    // Taken by another booking, or no longer fitting the technician's day once the drives are checked.
    gone: "That time isn’t free any more. Pick another.",
    // The day offered being full, and the days past the first fortnight.
    offeredFull: (day: string) => `${day} is full. We’ve picked the next open day.`,
    offeredFullPickAnother: (day: string) => `${day} is full. Pick another day.`,
    /** A replacement's hair system not held in the client's size: its days open once one can be there. */
    notInStock: (date: string) =>
      `Your next hair system isn’t in stock in your size yet. The earliest fitting is ${date}.`,
    later: "Later dates",
    laterFailed: "Those dates didn’t load. Try again.",
  },
  /** Each step's way back, at its head. */
  back: "Back",
  pay: {
    title: "Review",
    /** Followed by the minutes and seconds left, in bold. */
    holding: "We’re holding this time for you for ",
    visit: "Visit",
    when: "When",
    technician: "Technician",
    /** Who comes is never promised (docs/decisions/0111-a-technician-never-takes-two-visits-in-a-row.md). */
    assigned: "Assigned by us",
    address: "Address",
    changeAddress: "Change",
    total: "Total",
    /** Once GST applies, the total says it is in it. */
    totalWithGst: "Total, incl. GST",
    payment: "Payment",
    razorpay: "Pay by UPI, card, netbanking or wallet on Razorpay’s secure checkout. Saved methods appear there.",
    /** Checkout closed with nothing paid. */
    notCompleted: "Payment not completed. Your time is still held.",
    /** What changing the visit later costs, and when it starts to. */
    changing: "Changing your plans",
    now: "Now",
    theVisit: "Visit",
    // The pay step says "Free to move until"; cancelling is free until then too.
    freeUntil: (when: string) => `Free to move or cancel until ${when}.`,
    afterThat: " After that, changes are charged.",
    /** A visit sold already inside its notice says what a change costs at once. */
    insideNotice: {
      /** Followed by the fee's GST split, where there is one, and a full stop. */
      lateFee: (hours: number, amount: string) =>
        `This visit is less than ${String(hours)} hours away: moving or cancelling it costs ${amount}`,
      payment: (hours: number, amount: string) =>
        `This visit is less than ${String(hours)} hours away: if you move or cancel it, the ${amount} paid isn’t refunded.`,
      credit: (hours: number) =>
        `This visit is less than ${String(hours)} hours away: if you move or cancel it, the free service visit isn’t returned.`,
    },
    // A booking ops set to cost nothing when changed late (docs/decisions/0088-every-policy-in-the-console.md).
    freeAnyTime: "Free to move or cancel at any time.",
    pay: (amount: string) => `Pay ${amount}`,
    guarantee: GUARANTEE,
    // A free consultation has no payment.
    free: "Free",
    confirm: "Confirm visit",
    // A free service visit covers it.
    credit: {
      zero: "Free",
      used: "1 free service visit used",
      remaining: (left: number) => `${String(left)} remaining`,
      /** The notice the hold is sold under, which ops set: 24 hours to begin with. */
      note: (hours: number) => `Cancel inside ${String(hours)} hours and the free service visit is gone.`,
    },
    /**
     * Ticked, it records the client's yes to WhatsApp about their
     * visits, the reminder, moves and changes among them, on a notice of this line alone.
     */
    remind: "Send me visit updates on WhatsApp",
    /** Ticked before a new booking can be paid for or confirmed; the booking records it with each version. */
    agree: {
      before: "I agree to the ",
      terms: "Terms and Conditions",
      between: " and the ",
      privacy: "Privacy Policy",
      after: ".",
    },
    // Every visit is photographed for the client's record, which booking says and agrees to nothing more: referral
    // cards are their choice when they first share an invite.
    /**
     * Booking a visit also agrees to the photograph purposes the client has never
     * decided on, one tap away beneath Pay. With the referral card's lines (profile.referralCards), they are the
     * notice each consent is recorded under, word for word (src/config/notices.ts; booking/consents.ts).
     */
    photos: { line: VISIT_PHOTOS },
    /**
     * A discount code (docs/decisions/0108-discount-codes.md). One that does not apply is told only that, whatever
     * the reason.
     */
    code: {
      open: "Have a discount code?",
      label: "Discount code",
      apply: "Apply",
      applying: "Applying…",
      /** "Code TENOFF: Rs. 1,234 off", beneath the price: what it takes off the price shown, GST included. */
      applied: (code: string, off: string) => `Code ${code}: ${off} off`,
      remove: "Remove code",
      removing: "Removing…",
      errors: {
        code_not_applicable: "That code doesn’t apply to this visit.",
        rate_limited: "Too many codes tried. Try again tomorrow.",
        already_discounted: "This visit already has a code.",
        price_settled: "Payment has started, so the code can no longer change.",
        hold_expired: "Your time ran out. Pick a time again.",
        offline: "You’re offline. Reconnect and try again.",
        unknown: "That didn’t go through. Try again.",
      } as Readonly<Record<string, string>>,
    },
  },
  /**
   * The credit step's late-fee line, which the move sheet repeats word for word: the amount charged, and its GST split after it,
   * muted, once GST applies.
   */
  lateFee: {
    /** The notice is the one the visit is sold under, which ops set: 24 hours to begin with. */
    costs: (amount: string, hours: number) => `Moving or cancelling inside ${String(hours)} hours costs ${amount}`,
    split: (split: string) => ` (${split})`,
    rest: ". The rest moves with your visit, or comes back to you.",
  },
  // Said to a screen reader, once, a minute before the hold lapses.
  lastMinute: "One minute left to pay. Then the time is released.",
  /** On the review, over Pay, which tries again: Checkout offers every way to pay. */
  failed: {
    title: "The payment didn’t go through.",
    line: "Nothing was booked. If money left your account, it comes back automatically. Try again, or use another method.",
  },
  expired: {
    title: "That time has been released",
    line: "Nothing was charged.",
    pickAgain: "Pick another time",
  },
  /** The hair system the consultation recommended, beside its name in the chooser. */
  recommended: (technician: string | null) => (technician === null ? "Recommended" : `Recommended by ${technician}`),
  confirmed: {
    /** Over the day, on the navy: what was booked. */
    label: {
      consultation: "Consultation booked",
      first_fit: "First fit booked",
      service: "Visit booked",
      replacement: "Replacement booked",
    },
    moved: "Visit moved",
    arrives: (hours: string) => `Arrives ${hours}`,
    technician: "Technician",
    /** Who comes is fixed and named the evening before (docs/decisions/0290-allotted-the-evening-before.md). */
    dayBefore: "Confirmed the day before",
    address: "Address",
    payment: "Payment",
    paid: (amount: string) => `${amount} paid`,
    credit: "Free service visit",
    carriedOver: "Carried over",
    free: "Free",
    /** The reminder is ours, sent automatically, not the technician's. */
    tellsYou: "We remind you the day before.",
    note: (name: string | null) => (name === null ? "Add a note for your technician" : `Add a note for ${name}`),
    close: "Done",
  },
  /** While Razorpay's word and the booking are awaited: a title, and a line beneath it. */
  confirming: {
    paid: "Confirming your payment",
    free: "Confirming your visit",
    line: "This takes a few seconds.",
  },
  // The hold's time ran out on the phone after Razorpay had taken the payment, which keeps it.
  paidIn: PAID_IN,
  slow: {
    title: "This is taking longer than usual",
    line: TOLD_WHEN_BOOKED,
    /** For a free visit to a client who has not agreed to WhatsApp about visits: nothing will be sent. */
    quiet: "Check Home in a minute.",
  },
  refunded: {
    title: "We couldn’t book that visit",
    line: "We’re refunding your payment in full.",
  },
  failedToStart: "That didn’t go through. Try again.",
  /** The times a client may hold in an hour are spent. */
  heldTooOften: "That’s all the times we can hold for you this hour. Try again later, or message us on WhatsApp.",
  creditGone: "Your free service visit is already used, so this visit is charged at the price below.",
  close: "Close",
} as const;

/**
 * A note on a visit to come, kept on it for the technician's card.
 */
export const note = {
  title: (technician: string | null) =>
    technician === null ? "Add a note for your technician" : `Add a note for ${technician}`,
  /** The sheet again, on a visit that already has the client's note. */
  yours: (technician: string | null) =>
    technician === null ? "Your note for your technician" : `Your note for ${technician}`,
  /** The note shown back on its visit's card. */
  shown: (text: string) => `Your note: “${text}”`,
  label: "What should they know at the door?",
  offline: "No connection. Save once you’re back online.",
  save: "Save note",
  saving: "Saving…",
  saved: (technician: string | null) =>
    technician === null
      ? "Saved. Your technician reads it before your visit."
      : `Saved. ${technician} reads it before your visit.`,
  withOps: "Notes for this visit go to us on WhatsApp.",
  failed: "That didn’t go through.",
  whatsapp: "Send it on WhatsApp",
};

export const dispute = {
  title: "Dispute this charge",
  label: "Why is the charge wrong?",
  send: "Send",
  sending: "Sending…",
  sent: "Dispute received. We’ll be in touch.",
  already: "You’ve already disputed this charge. We’ll let you know our decision.",
  closed: "The time to dispute this charge has passed. Message us if something’s wrong.",
  failed: "That didn’t go through. Try again.",
  tryAgain: "Try again",
};

/**
 * Moving or cancelling a visit (docs/decisions/0046-moving-and-cancelling.md). The consequence
 * shows before the client confirms. The design writes refunds as "three to five working days"; the app says
 * 5 to 7 (ADR 0025, item 28).
 */
export const change = {
  visit: (weekday: string) => `${weekday}’s visit`,
  move: {
    /** "Service visit on Thu 19 Nov": what the visit is and its day, over the ways to change it. */
    title: (what: string, date: string) => `${what} on ${date}`,
    free: (amount: string) => `Free to move. Your ${amount} carries over.`,
    charged: (amount: string) =>
      `This is a late change: your ${amount} isn’t refunded, and the new visit is paid separately.`,
    pick: "Move to another time",
    accept: "Move and accept charge",
    // Nothing paid, and the way to the cancel sheet. A late fee's line is the credit step's (booking.lateFee).
    freeNothingPaid: "Free to move.",
    // What a move in place keeps, on its pay step.
    carriesOver: (amount: string) => `Your ${amount} carries over.`,
    creditCarriesOver: "Your free service visit carries over.",
    cancelInstead: "Cancel the visit",
    creditCharged:
      "This is a late change: your free service visit isn’t returned, and the new visit is paid separately.",
  },
  cancel: {
    title: (visit: string) => `Cancel ${visit}`,
    refund: (amount: string, destination: string) => `${amount} back to your ${destination} in ${REFUND_TAKES}.`,
    confirm: "Cancel visit",
    keep: "Keep it",
    lessFee: (fee: string, amount: string, destination: string) =>
      `The late fee of ${fee} is kept. ${amount} back to your ${destination} in ${REFUND_TAKES}.`,
    charged: (amount: string) => `This is a late cancellation: your ${amount} isn’t refunded.`,
    nothingPaid: "Nothing was paid, so nothing is charged.",
    accept: "Cancel and accept charge",
    creditBack: "Your free service visit comes back.",
    // The cancel sheet, inside 24 hours, for a booking a free service visit covers.
    creditUsed: (left: string | null, expiry: string) =>
      left === null
        ? "Your free service visit is used."
        : `Your free service visit is used. ${left} left, to use by ${expiry}.`,
    acceptCredit: "Cancel and use it",
    done: "Cancelled",
    doneLine: (visit: string) => `${visit} is cancelled.`,
    refundPending: (amount: string) => `Your refund of ${amount} is on its way.`,
    close: "Done",
  },
  // What came of a change that did not go through.
  termsChanged: "The free change has just run out. This is what it costs now.",
  notChangeable: "This visit can no longer be changed here.",
  message: "Message us",
  failed: "That didn’t go through. Try again.",
  moveItem: (what: string) => `${what} · moved`,
  lateFeeItem: (what: string) => `Late fee · ${what.toLowerCase()}`,
  confirmMove: "Confirm move",
  destination: "payment method",
} as const;

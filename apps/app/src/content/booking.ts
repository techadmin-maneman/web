// Booking and changing a visit (boards C4 to C8): the sheet's steps, a note to the technician, a dispute.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { visitLength } from "./common.ts";
import { PAID_IN, TOLD_WHEN_BOOKED } from "./home.ts";

/** Booking in the app (boards C2 to C6), while self-serve booking is on. */
export const booking = {
  step: (n: number, of: number) => `Step ${String(n)} of ${String(of)}`,
  /** How long a visit takes, as the choice of visit and the pay step say it. */
  length: visitLength,
  /**
   * No board draws it. With more than one service open to them, the client chooses first: every one
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
  /** No board draws it. A first fit while ops offer no hair system in the console. */
  firstFitNotYet: "First fits aren’t open to book yet.",
  /**
   * No board draws it. A client who has given no address is asked for it before any slot (ADR 0079;
   * ADR 0025, item 60), under Profile's heading, "Where we come".
   */
  address: {
    why: "Your address first, so we know where to come. Then pick a date.",
    refused: "We need your address before we can hold a time. Add it, then pick a time again.",
    save: "Save and continue",
  },
  /** No board draws it. The client's address is in a pincode we do not come to, so no day is offered. */
  notServed: {
    line: (pincode: string) => `We don’t come to ${pincode} yet.`,
    body: "Change the address below, or join the waitlist and we’ll message you the day we do.",
    waitlist: "Join the waitlist",
  },
  date: {
    title: "Pick a date",
    available: "Available",
    full: "Full",
    // No board draws it. A day with a window already inside the notice is still sold, and marked.
    within: (hours: number) => `Within ${String(hours)} hours: changes are charged`,
    continue: "Continue",
    // No board draws the day offered being full, nor the days past the first fortnight.
    offeredFull: (day: string) => `${day} is full. We’ve picked the next open day.`,
    offeredFullPickAnother: (day: string) => `${day} is full. Pick another day.`,
    later: "Later dates",
    laterFailed: "Those dates didn’t load. Try again.",
  },
  window: {
    title: "Pick a time",
    full: "Full",
    withRegular: (name: string) => `With ${name}`,
    another: "Another technician",
    regularLine: (name: string) => `${name}, your regular technician, is free.`,
    // The design draws the window step with the regular technician free.
    anotherLine: (name: string) => `${name} isn’t free then. Another technician will come.`,
    // A window already inside the notice, which no board draws.
    within: (hours: number) => `Within ${String(hours)} hours: changes are charged`,
    continue: "Continue to payment",
    // A visit that costs nothing has no payment to continue to.
    continueFree: "Continue",
    taken: "That time has just gone. Pick another.",
  },
  pay: {
    title: "Pay and confirm",
    // A visit that costs nothing to book, which no board draws.
    titleFree: "Confirm",
    held: (time: string) => `Held for ${time}`,
    // Board C4 says "Free to move until"; cancelling is free until then too.
    freeUntil: (when: string) => `Free to move or cancel until ${when}.`,
    afterThat: " After that it is charged.",
    /** No board draws it. A visit sold already inside its notice says what a change costs at once. */
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
    neverHandlesMoney: (name: string) => `${name} never handles money.`,
    guarantee: GUARANTEE,
    // A free consultation has no payment; the design draws the credit board's button.
    free: "Free",
    confirm: "Confirm visit",
    // Board C5: a free service visit covers it. Our words: the reward's name, in place of the board's.
    credit: {
      zero: "Rs. 0",
      used: "1 free service visit used",
      remaining: (left: number) => `${String(left)} remaining`,
      /** The notice the hold is sold under, which ops set: 24 hours to begin with. */
      note: (hours: number) => `Cancel inside ${String(hours)} hours and the free service visit is gone.`,
    },
    /**
     * The design never asks. Ticked, it records the client's yes to WhatsApp about their
     * visits, the reminder, moves and changes among them, on a notice of this line alone.
     */
    remind: "Send me visit updates on WhatsApp",
    /**
     * No board draws them. Booking a visit also agrees to the photograph purposes the client has never
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
     * Our words, all of them: no board draws a discount code (docs/decisions/0108-discount-codes.md).
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
   * Board C5's late-fee line, which C7 repeats word for word: the amount charged, and its GST split after it,
   * muted, once GST applies.
   */
  lateFee: {
    /** The notice is the one the visit is sold under, which ops set: 24 hours to begin with. */
    costs: (amount: string, hours: number) => `Moving inside ${String(hours)} hours costs ${amount}`,
    split: (split: string) => ` (${split})`,
    rest: ". The balance carries over.",
  },
  // Said to a screen reader, once, a minute before the hold lapses.
  lastMinute: "One minute left to pay. Then the time is released.",
  failed: {
    label: "Payment failed",
    title: "The payment didn’t go through.",
    held: (time: string) => `Held for ${time} more.`,
    retry: "Try again",
  },
  expired: {
    label: "Time’s up",
    title: "That time has been released.",
    pickAgain: "Pick again",
  },
  confirmed: {
    label: "Confirmed",
    /** The board writes "Imran messages you the day before."; the reminder is ours, sent automatically (CP-08). */
    tellsYou: "We’ll remind you on WhatsApp the day before.",
    paid: "Paid",
    note: (name: string) => `Add a note for ${name}`,
    close: "Done",
  },
  confirming: "Confirming your visit.",
  // The hold's time ran out on the phone after Razorpay had taken the payment, which keeps it.
  paidIn: PAID_IN,
  slow: `This is taking longer than usual. ${TOLD_WHEN_BOOKED}`,
  /** The same, for a free visit to a client who has not agreed to WhatsApp about visits: nothing will be sent. */
  slowQuiet: "This is taking longer than usual. It shows on Home once it’s booked.",
  refunded: "We couldn’t book that visit, so we’re refunding your payment in full.",
  failedToStart: "That didn’t go through. Try again.",
  creditGone: "Your free service visit is already on another booking, so this visit is charged at the price below.",
  close: "Close",
} as const;

/**
 * A note on a visit to come, kept on it for the technician's card (REQ-04). Our words: the design draws the
 * "Add a note" button and no sheet behind it.
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
  offline: "No connection. Your note stays here until you are back online.",
  save: "Save the note",
  saving: "Saving",
  saved: (technician: string | null) =>
    technician === null
      ? "Saved. Your technician reads it before your visit."
      : `Saved. ${technician} reads it before your visit.`,
  withOps: "For now, notes go to us on WhatsApp.",
  failed: "That didn’t go through.",
  whatsapp: "Send it on WhatsApp",
};

/**
 * Disputing a no-show's charge, which no board draws (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md),
 * in the note sheet's frame.
 */
export const dispute = {
  title: "Dispute this charge",
  label: "Why is the charge wrong?",
  send: "Send",
  sending: "Sending",
  sent: "We have your dispute. We’ll look into it and let you know.",
  already: "You’ve already disputed this charge. We’ll let you know what we decide.",
  closed: "The days to dispute this charge have passed. If something is wrong, message us.",
  failed: "That didn’t go through. Try again.",
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
    charged: (amount: string) => `Charged. The ${amount} isn’t refunded and the new visit is paid separately.`,
    pick: "Pick a new date",
    accept: "Move and accept charge",
    keep: "Keep it",
    // Our words from here to the end of move: nothing paid, and the way to C8, which the design draws but does
    // not reach. A late fee's line is board C5's (booking.lateFee).
    freeNothingPaid: "Free to move.",
    // What a move in place keeps, on its pay step.
    carriesOver: (amount: string) => `Your ${amount} carries over.`,
    creditCarriesOver: "Your free service visit carries over.",
    cancelInstead: "Cancel the visit instead",
    creditCharged: "Charged. The free service visit isn’t returned and the new visit is paid separately.",
  },
  cancel: {
    title: (visit: string) => `Cancel ${visit}`,
    refund: (amount: string, destination: string) => `${amount} back to your ${destination} in 5 to 7 working days.`,
    confirm: "Cancel visit",
    keep: "Keep it",
    lessFee: (fee: string, amount: string, destination: string) =>
      `The late fee of ${fee} is kept. ${amount} back to your ${destination} in 5 to 7 working days.`,
    charged: (amount: string) => `Charged. The ${amount} isn’t refunded.`,
    nothingPaid: "Nothing was paid, so nothing is charged.",
    accept: "Cancel and accept charge",
    creditBack: "Your free service visit comes back.",
    // Board C8, inside 24 hours, for a booking a free service visit covers. Our words: the reward's name in it.
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
  failed: "That didn’t go through, and nothing has changed. Try again.",
  moved: "Moved",
  moveItem: (what: string) => `${what} · moved`,
  lateFeeItem: (what: string) => `Late fee · ${what.toLowerCase()}`,
  confirmMove: "Confirm the move",
  destination: "UPI",
} as const;

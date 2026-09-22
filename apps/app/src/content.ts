// Every word the client app shows, from design/phase2/Client App.dc.html. A
// component holds no copy of its own. Lines the design does not draw are
// marked PLACEHOLDER, pending the owner's wording.

export const whatsapp = {
  /** The business WhatsApp number, as the public site's footer and wa.me links use it. */
  number: "919007973247",
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
    automatic: "Read automatically where your phone allows",
    sms: "Send by SMS instead",
    resendIn: "Resend on WhatsApp in",
    resend: "Resend on WhatsApp",
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

/** The window a Phase 1 booking asked for, as one of the three (docs/decisions/0040-phase-1-alignment.md). */
export const PHASE1_WINDOWS: Readonly<Record<string, WindowLabel>> = {
  "before noon": "morning",
  "after four": "evening",
};

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
  document: (what: string, reference: string) => `Please send me the ${what.toLowerCase()} for ${reference}.`,
} as const;

export const home = {
  profile: "Your profile",
  reschedule: "Reschedule",
  note: "Add a note",
  consultation: {
    label: "Your consultation",
    free: "Free · nothing to pay",
  },
  next: {
    label: "Your next visit",
    length: (what: string, minutes: number) => `${what} · ${String(minutes)} minutes`,
    // PLACEHOLDER: the design draws no Home for a fitted client with nothing booked.
    none: "No visit booked.",
    book: "Book your next visit",
    // PLACEHOLDER: a lead whose consultation is done.
    bookFirstFit: "Book your first fit",
  },
  expect: {
    label: "What to expect",
    steps: [
      "A template of your scalp, in cling film and tape.",
      "Your colour matched against forty samples.",
      "Nothing fitted, nothing ordered on the day.",
    ],
  },
  // PLACEHOLDER: the design draws no Home for a client with nothing booked.
  nothing: {
    title: "Nothing booked",
    body: "Book a free consultation, and the app will show it here.",
    book: "Book a free consultation",
  },
} as const;

export const visits = {
  title: "Visits",
  upcoming: "Upcoming",
  past: "Past",
  // PLACEHOLDER
  none: "No visits booked.",
  book: "Book your next visit",
  detail: {
    back: "Back to visits",
    photographs: "Photographs from this visit",
    technician: "Technician",
    duration: "Duration",
    type: "Type",
    done: "What was done",
  },
} as const;

/** Booking in the app (boards C2 to C6), while self-serve booking is on. */
export const booking = {
  step: (n: number) => `Step ${String(n)} of 3`,
  date: {
    title: "Pick a date",
    available: "Available",
    full: "Full",
    continue: "Continue",
  },
  window: {
    title: "Pick a window",
    full: "Full",
    regularFree: (name: string) => `${name} free`,
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
    incl: (amount: string) => `${amount} incl. GST`,
    freeUntil: (when: string) => `Free to move until ${when}. After that it is charged.`,
    with: "Pay with",
    upi: "UPI · any app",
    // PLACEHOLDER: the design draws a saved card ("Card ending 4417"); Checkout asks for the card.
    card: "Card",
    pay: (amount: string) => `Pay ${amount}`,
    neverHandlesMoney: (name: string) => `${name} never handles money.`,
    firstFit: "First fit · standard",
    firstFitBlock: "Two slots · 3 hours",
    guarantee: (name: string) => `If the fit is not right, ${name} stops and you are refunded in full.`,
    lateFee: (amount: string) => `Moving inside 24 hours costs ${amount}. The balance carries over.`,
    // PLACEHOLDER: a free consultation has no payment; the design draws the credit board's button.
    free: "Free",
    confirm: "Confirm visit",
    // Board C5: a service-visit credit covers it.
    credit: {
      zero: "Rs. 0",
      used: "1 visit credit used",
      remaining: (left: number) => `${String(left)} remaining`,
      note: "Cancel inside 24 hours and the credit is gone.",
    },
  },
  failed: {
    label: "Payment failed",
    title: "The payment did not go through.",
    held: (time: string) => `Slot held ${time} more.`,
    retry: "Try again",
    another: "Another method",
  },
  expired: {
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
  slow: "This is taking longer than usual. We will message you on WhatsApp when the visit is booked.",
  refunded: "We could not book that visit, so your payment is being refunded in full.",
  failedToStart: "That did not go through. Please try again.",
  close: "Close",
} as const;

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
    // PLACEHOLDER from here to the end of move: nothing paid, board C5's late-fee line, and the way to C8,
    // which the design draws but does not reach.
    freeNothingPaid: "Free to move.",
    lateFee: (fee: string) => `Moving inside 24 hours costs ${fee}. The balance carries over.`,
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
  termsChanged: "The 24 hours have just run out. This is what it costs now.",
  notChangeable: "This visit can no longer be changed here.",
  message: "Message us",
  failed: "That did not go through, and nothing has changed. Please try again.",
  moved: "Moved",
  moveItem: (what: string) => `${what} · moved`,
  lateFeeItem: (what: string) => `Late fee · ${what.toLowerCase()}`,
  confirmMove: "Confirm the move",
  destination: "UPI",
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
  // PLACEHOLDER: the divider's name for a screen reader, and the compare opened with fewer than two visits.
  divider: "Divider between the two photographs",
  compareNone: "Compare opens once two visits have photographs.",
  download: "Download",
  downloaded: "Downloaded photographs sit in your gallery, outside the app.",
  photoOf: (angle: string, date: string) => `${angle} · ${date}`,
  // PLACEHOLDER
  close: "Close",
} as const;

export const payments = {
  title: "Payments",
  back: "Back to payments",
  // PLACEHOLDER: an entry that paid for no visit we know of.
  payment: "Payment",
  refundOf: (what: string) => `${what} · refund`,
  // PLACEHOLDER: a late fee's name, and a charge's row; the evidence is the design's ("cancelled 9:14 am, visit
  // was 10 am"), with the dates when the two fall on different days.
  lateFeeOf: (what: string) => `${what} · late fee`,
  charge: "Charge",
  charged: "Charged",
  evidence: (change: "cancelled" | "moved", at: string, visit: string) => `${change} ${at}, visit was ${visit}`,
  refundTo: (method: string) => `refund to ${method}`,
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
  /** A method as a list's meta line writes it ("22 Aug · UPI"), and as the detail's row does ("UPI"). */
  methods: {
    upi: ["UPI", "UPI"],
    card: ["card", "Card"],
    netbanking: ["net banking", "Net banking"],
    wallet: ["wallet", "Wallet"],
    emi: ["EMI", "EMI"],
    paylater: ["pay later", "Pay later"],
  } as Readonly<Record<string, readonly [string, string]>>,
  incl: (amount: string) => `${amount} incl.`,
  including: (amount: string, percent: number) => `${amount} including GST at ${String(percent)}%`,
  // PLACEHOLDER: the design draws a payment's rows; a refund's "Refunded to" is ours.
  rows: { date: "Date", method: "Method", destination: "Refunded to", status: "Status", reference: "Reference" },
  documents: "Tax documents",
  invoice: "Tax invoice",
  receipt: "Receipt",
  // PLACEHOLDER
  voucher: "Refund voucher",
  unavailable: {
    invoice: "The invoice is still generating. Usually ready within the hour.",
    // PLACEHOLDER: receipts and vouchers wait for the invoicing route (docs/open-points.md, item 3).
    receipt: "The receipt is not ready yet.",
    voucher: "The refund voucher is not ready yet.",
    notify: "Notify me",
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
    lines: [
      "Nobody you have referred has been fitted yet.",
      "When a friend you refer is fitted, you both get 3 service visits free.",
    ],
  },
} as const;

export const profile = {
  back: "Back",
  where: "Where we come",
  editAddress: "Edit address and access notes",
  // PLACEHOLDER: the design draws the profile with an address already given, and no form.
  noAddress: "No address yet. We confirm it with you before your visit.",
  addAddress: "Add your address and access notes",
  form: {
    line1: "House, flat or building",
    line2: "Street (optional)",
    locality: "Sector or area",
    city: "City",
    pincode: "Pincode",
    accessNotes: "Access notes (optional)",
    accessHint: "A gate code, or where to park. Your technician sees it the day before the visit.",
    save: "Save",
    cancel: "Cancel",
    invalid: "Fill in the house, the area, the city and a six-digit pincode.",
  },
  agreed: "What you have agreed to",
  purposes: {
    photos_own_record: "Photographs for your own record",
    photos_referral_cards: "Photographs on referral cards",
    photos_marketing: "Photographs in our marketing",
    whatsapp_visits: "WhatsApp about your visits",
    // PLACEHOLDER: the design's profile lists four; the fifth is the waitlist's launch alert.
    whatsapp_launches: "WhatsApp about launches",
  },
  given: (date: string) => `Given ${date}`,
  notGiven: "Not given",
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
    failed: "That did not go through. Please try again.",
    limited: "You have started three changes today. Please try again tomorrow.",
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
    sent: "Received. We answer within 30 days, on WhatsApp.",
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
  },
  // PLACEHOLDER: the design has no logout; it ends the session on this device.
  logout: "Log out",
} as const;

/** Board B3: loading, offline and error. */
export const states = {
  loading: "Loading",
  offline: "No connection. Showing your last update.",
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

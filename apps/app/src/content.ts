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

/** The window a Phase 1 booking asked for (docs/decisions/0040-phase-1-alignment.md). */
export const WINDOWS: Readonly<Record<string, string>> = {
  "before noon": "Morning, 9 am to 12 pm",
  "after four": "Evening, 4 pm to 8 pm",
};

export const home = {
  profile: "Your profile",
  consultation: {
    label: "Your consultation",
    free: "Free · nothing to pay",
    reschedule: "Reschedule",
    note: "Add a note",
    // PLACEHOLDER: while self-serve booking is off, both open WhatsApp to ops with a message ready.
    rescheduleMessage: (date: string) => `I would like to move my consultation on ${date}.`,
    noteMessage: (date: string) => `A note about my consultation on ${date}: `,
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
  consultation: "Consultation",
  // PLACEHOLDER
  none: "No visits booked.",
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
  /** The four lines the design shows before a card is turned on (F3); the consent's notice carries them. */
  referralCards: {
    lines: [
      "Anyone you send this card to can see your photographs.",
      "They can forward it, and so can anyone who receives it.",
      "You can switch it off at any time, and new opens will show our house example instead.",
      "Cards already delivered stay in people’s chats. We cannot take those back.",
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
    // The design's second line, "Your visit is still booked.", waits for Home's own visit data (P2-F2):
    // until then the app cannot know that there is one.
    retry: "Try again",
    message: "Message us",
  },
} as const;

export const errors = {
  // PLACEHOLDER: the design draws no error for the profile.
  load: "We could not load this. Please try again.",
  retry: "Try again",
} as const;

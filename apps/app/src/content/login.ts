// Signing in: the number, the code and the help.

export const login = {
  /** Under a limit on codes, on the number and the code screens. */
  messageUs: "Message us on WhatsApp",
  mobile: {
    title: "Your mobile number",
    prefix: "+91",
    label: "Mobile number",
    send: "Send code on WhatsApp",
    hint: "A six-digit code, no password.",
    // The design draws no session that ended while the app was open.
    ended: "You’ve been signed out. Sign in to continue.",
    // The design draws no error on the sign-in.
    errors: {
      invalid: "Enter the ten-digit mobile number you booked with.",
      rate_limited: "Too many codes for this number today. Try again tomorrow, or message us.",
      busy: "We can’t send codes right now. Try again in a few minutes.",
      turnstile_failed: "We couldn’t confirm you’re a person. Try again.",
      offline: "You’re offline. Reconnect and try again.",
      unknown: "Something went wrong. Try again.",
    },
  },
  code: {
    back: "Back",
    title: "Enter the code",
    /**
     * Neutral on purpose (ADR 0030): the screen never says whether
     * the number has a booking. Our wording; the design's is "Sent on
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
    // Said to a screen reader once, when the countdown runs out.
    canResend: "You can ask for a new code now.",
    submit: "Continue",
    noBooking: "No booking on this number?",
    /** The design's one line, "That code did not match. Two attempts left." */
    mismatch: (left: number) =>
      left === 0
        ? "That code didn’t match, and it no longer works."
        : `That code didn’t match. ${ATTEMPTS[left] ?? `${String(left)} attempts left.`}`,
    // The design draws the void code, but not these words or the ones below.
    expired: "This code no longer works.",
    fresh: "Send a new code",
    failed: "That didn’t go through. Try again.",
    // The design draws no resend that is refused.
    limited: "We can’t send another code right now. Use the last one we sent, or message us.",
  },
  help: {
    back: "Back",
    // The design's title is "We have no booking on this number"; neutral, it becomes a question (ADR 0030).
    title: "No booking on this number?",
    body: "Book a free consultation to get started.",
    hint: "Try the number you gave us, or message us and we’ll link it.",
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

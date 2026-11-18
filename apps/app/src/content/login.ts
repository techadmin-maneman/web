// Signing in: the number, the code and the help.

import { CLIENT_WORDS, codeMismatch } from "@maneman/web-kit/client-words";

export const login = {
  /** Under a limit on codes, on the number and the code screens. */
  messageUs: "Message us on WhatsApp",
  mobile: {
    title: "Sign in",
    /** The brand's name, as the lockup above the title reads. */
    brand: "Mane Man",
    lede: "Use the mobile number you booked with. We’ll send a 6-digit code on WhatsApp.",
    prefix: "+91",
    label: "Mobile number",
    send: "Send code on WhatsApp",
    /** Beneath Send, for a number with no booking yet. */
    newHere: "New to Mane Man?",
    book: "Book a free consultation",
    ended: "You’ve been signed out. Sign in to continue.",
    errors: {
      invalid: "Enter the 10-digit mobile number you booked with.",
      rate_limited: "Too many codes for this number today. Try again tomorrow, or message us.",
      busy: "We can’t send codes right now. Try again in a few minutes.",
      turnstile_failed: "We couldn’t confirm you’re a person. Try again.",
      offline: "You’re offline. Reconnect and try again.",
      unknown: CLIENT_WORDS.failed,
    },
  },
  code: {
    back: "Back",
    title: "Enter the code",
    /**
     * Neutral on purpose (ADR 0030): the screen never says whether
     * the number has a booking.
     */
    sentWhatsapp: (number: string) => `If ${number} has a visit booked with us, a code is on its way on WhatsApp.`,
    sentSms: (number: string) => `If ${number} has a visit booked with us, a code is on its way by SMS.`,
    label: "The 6-digit code",
    /** Shown only for a code sent by SMS: WebOTP reads an SMS, and never a WhatsApp message. */
    automatic: "Read automatically where your phone allows",
    sms: "Send by SMS instead",
    resendIn: "Resend on WhatsApp in",
    resend: "Resend on WhatsApp",
    // Said to a screen reader once, when the countdown runs out.
    canResend: "You can ask for a new code now.",
    submit: "Continue",
    noBooking: "No visit booked on this number?",
    /** "That code didn’t match. 2 tries left.", as the site says it. */
    mismatch: codeMismatch,
    expired: "This code no longer works.",
    fresh: "Send a new code",
    failed: "That didn’t go through. Try again.",
    limited: "We can’t send another code right now. Use the last one we sent, or message us.",
  },
  help: {
    back: "Back",
    // The design's title is "We have no booking on this number"; neutral, it becomes a question.
    title: "No visit booked on this number?",
    body: "Book a free consultation to get started.",
    hint: "Try the number you gave us, or message us and we’ll link it.",
    book: "Book a free consultation",
    message: "Message us",
  },
} as const;

// The client app's words every screen may use: its name and titles, WhatsApp and the site's booking page, a
// visit's windows, kinds and length, the messages it opens WhatsApp with, and the loading and failure lines.

import { lengthWords } from "@maneman/web-kit/visit-length";
import type { EnvironmentName } from "@rules/config/environments.ts";
import { indiaTimeOf } from "@maneman/web-kit/dates";
import { WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";
import { timeRange, UNBROKEN } from "@rules/lib/time-range.ts";
import { notYetOpenLines } from "./refer.ts";

export const app = {
  /** Last in the browser's title, after the screen's own name: "Visits · Mane Man". */
  name: "Mane Man",
} as const;

/**
 * Each page's name in the browser's title (WCAG 2.4.2), by the route it is at (apps/app/src/route.ts).
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
  replacement: "Replacement",
} as const;

export const whatsapp = {
  /** The business WhatsApp number, as the public site's footer and wa.me links use it. */
  number: WHATSAPP_NUMBER,
} as const;

/** The public site's booking page, for a number with no booking yet. */
export const BOOKING_URL: Readonly<Record<EnvironmentName, string>> = {
  local: "http://127.0.0.1:4321/book",
  staging: "https://staging.maneman.in/book",
  production: "https://maneman.in/book",
};

/** The public site's full notices, a section each, which each consent's one line links to (ADR 0219). */
export const NOTICES_URL: Readonly<Record<EnvironmentName, string>> = {
  local: "http://127.0.0.1:4321/notices",
  staging: "https://staging.maneman.in/notices",
  production: "https://maneman.in/notices",
};

/** The public site's terms and privacy policy, which a booking agrees to. */
export const LEGAL_URLS: Readonly<Record<EnvironmentName, { readonly terms: string; readonly privacy: string }>> = {
  local: { terms: "http://127.0.0.1:4321/terms", privacy: "http://127.0.0.1:4321/privacy" },
  staging: { terms: "https://staging.maneman.in/terms", privacy: "https://staging.maneman.in/privacy" },
  production: { terms: "https://maneman.in/terms", privacy: "https://maneman.in/privacy" },
};

/** The public site's try-on, for a client with no photographs yet: the look it makes comes back to Photos. */
export const TRY_ON_URL: Readonly<Record<EnvironmentName, string>> = {
  local: "http://127.0.0.1:4321/try",
  staging: "https://staging.maneman.in/try",
  production: "https://maneman.in/try",
};

/** The three windows a visit is booked in (design/phase2/Client App, the windows data). */
export const WINDOW_NAMES = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;

/** The day's parts in order, which the time step groups its starts under. */
export const BOOKING_WINDOW_ORDER = ["morning", "afternoon", "evening"] as const;

/** A window's hours on its day, as the API gives them: "12:00" to "16:00". */
interface Hours {
  readonly start: string;
  readonly end: string;
}

/** "12–4 pm", "9 am–12 noon": a window's hours as ops set them for its day. */
export const windowHours = (hours: Hours) => timeRange(hours.start, hours.end, UNBROKEN);

/**
 * "11:30 am–12 pm": when the technician arrives, from the visit's start to the end of its arrival window
 * (docs/decisions/0210-booking-by-start-time.md).
 */
export const arrivalHours = (visit: { readonly starts_at: string; readonly arrives_by: string }, spaces = UNBROKEN) =>
  timeRange(indiaTimeOf(visit.starts_at), indiaTimeOf(visit.arrives_by), spaces);

type WindowLabel = keyof typeof WINDOW_NAMES;

/** "Afternoon, 12–4 pm", as a visit's card gives its window. */
export const windowText = (label: WindowLabel, hours: Hours) => `${WINDOW_NAMES[label]}, ${windowHours(hours)}`;

/** A visit to come, offered to the client's own calendar. */
export const calendar = {
  label: "Add to your calendar",
  google: "Google Calendar",
  file: "Apple or Outlook",
  fileName: "mane-man-visit.ics",
  title: (visit: string) => `Mane Man: ${visit}`,
  details: (hours: string, technician: string | null) =>
    technician === null ? `Arriving ${hours}.` : `Arriving ${hours}, with ${technician}.`,
};

/** Each kind of visit, as the design names it. */
export const VISIT_TYPES = {
  consultation: "Consultation",
  first_fit: "First fit",
  service: "Service visit",
  replacement: "Replacement",
} as const;

// A visit of none of the four kinds.
export const OTHER_VISIT = "Visit";

// A consultation and fit in one visit, as the site and the technician's phone call it.
export const ONE_VISIT = "Consultation and fit";

/** How long a visit takes, or took, word for word as the site says it: "90 minutes", "3 hours". */
export const visitLength = lengthWords;

/** A price's GST, beneath the amount charged once GST applies: "Rs. 1,000 + Rs. 180 GST". */
export const gstSplit = (exGst: string, gst: string) => `${exGst} + ${gst} GST`;

/**
 * While self-serve booking is off, booking, rescheduling and notes open WhatsApp to ops with a message ready
 * (docs/prompts/phase2-backend.md, "Booking").
 */
export const messages = {
  // Beneath "Change", which moves or cancels: the message fits either.
  reschedule: (what: string, date: string) => `I’d like to change or cancel my ${what.toLowerCase()} on ${date}.`,
  note: (what: string, date: string) => `A note about my ${what.toLowerCase()} on ${date}: `,
  // A booking's opening words, which the day, the window, the client and the hair system follow (booking.asking).
  book: "I’d like to book my next visit",
  bookFirstFit: "I’d like to book my first fit",
  bookReplacement: "I’d like to book my replacement",
  document: (what: string, reference: string) => `Please send me the ${what.toLowerCase()} for ${reference}.`,
  // A visit's invoice that has not come in the day it should have.
  lateInvoice: (what: string, date: string) => `Please send me the invoice for my ${what.toLowerCase()} on ${date}.`,
  // A refund that has taken longer than Razorpay's working days.
  lateRefund: (what: string, date: string) => `My refund for my ${what.toLowerCase()} on ${date} hasn’t arrived.`,
  // A client moving to another city while a visit is booked.
  moveCity: "I’m moving to another city and have a visit booked.",
} as const;

export const empty = {
  photos: {
    title: "Photos",
    lines: ["Your photos begin at your first visit.", "Five angles at every visit, for your record."],
    // A way on while there is nothing to show.
    tryOn: "Try on a look",
  },
  payments: {
    title: "Payments",
    lines: ["Nothing to pay yet.", "Your consultation is free. Payments and invoices will appear here."],
  },
  // A consultation and fit in one visit, booked with nothing paid.
  paymentsOneVisit: {
    title: "Payments",
    lines: ["Nothing to pay yet.", "You pay by UPI at the visit, once fitted."],
  },
  paymentsFitted: {
    title: "Payments",
    lines: ["No payments yet.", "Payments and invoices will appear here."],
  },
  refer: {
    title: "Refer",
    lines: notYetOpenLines,
  },
} as const;

/** The states screen: loading, offline and error. */
export const states = {
  loading: "Loading…",
  /** On Home, which the phone keeps. */
  offline: "No connection. Showing your last update.",
  // On a page the phone does not keep.
  offlineOnly: "No connection.",
  waiting: "This page loads when you’re back online.",
  error: {
    title: "We couldn’t load your account.",
    /** Said only when the phone has kept a Home with a visit on it. */
    booked: "Your visit is still booked.",
    retry: "Try again",
    message: "Message us",
  },
} as const;

/** A box with a limit, said beneath it: how much is left. */
export const fields = {
  left: (count: number) => (count === 1 ? "1 character left" : `${String(count)} characters left`),
} as const;

export const errors = {
  load: "This page didn’t load.",
  retry: "Try again",
  message: "Message us",
} as const;

/** A new version of the app, waiting to be taken (packages/web-kit/sw-update.ts). */
export const update = {
  line: "A new version is ready.",
  action: "Update",
} as const;

/** A page that failed to draw, which React would otherwise leave blank. */
export const broken = {
  message: "This page didn’t open.",
  reload: "Reload",
  home: "Home",
} as const;

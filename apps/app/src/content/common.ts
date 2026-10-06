// The client app's words every screen may use: its name and titles, WhatsApp and the site's booking page, a
// visit's windows, kinds and length, the messages it opens WhatsApp with, and the loading and failure lines.

import type { EnvironmentName } from "../../../../src/config/environments.ts";
import { WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";
import { notYetFittedLines } from "./refer.ts";

export const app = {
  /** Last in the browser's title, after the screen's own name: "Visits · Mane Man". */
  name: "Mane Man",
} as const;

/**
 * Each page's name in the browser's title (WCAG 2.4.2), by the route it is at (apps/app/src/route.ts).
 * Our words where no board names the page.
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

/** The three windows a visit is booked in (design/phase2/Client App, the windows data). */
export const WINDOW_NAMES = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" } as const;

export const WINDOW_HOURS = { morning: "9 am to 12 pm", afternoon: "12 to 4 pm", evening: "4 to 8 pm" } as const;

type WindowLabel = keyof typeof WINDOW_NAMES;

/** "Afternoon, 12 to 4 pm", as a visit's card gives its window. */
export const windowText = (label: WindowLabel) => `${WINDOW_NAMES[label]}, ${WINDOW_HOURS[label]}`;

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

/** How long a visit takes: "3 hours", "1 hour 30 minutes". */
export function visitLength(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [
    hours === 0 ? "" : `${String(hours)} ${hours === 1 ? "hour" : "hours"}`,
    rest === 0 ? "" : `${String(rest)} minutes`,
  ];
  return parts.filter((part) => part !== "").join(" ");
}

/** A price's GST, beneath the amount charged once GST applies: "Rs. 30,000 + Rs. 5,400 GST". */
export const gstSplit = (exGst: string, gst: string) => `${exGst} + ${gst} GST`;

/**
 * While self-serve booking is off, booking, rescheduling and notes open WhatsApp to ops with a message ready
 * (docs/prompts/phase2-backend.md, "Booking"). Our wording, all of it.
 */
export const messages = {
  reschedule: (what: string, date: string) => `I’d like to move my ${what.toLowerCase()} on ${date}.`,
  note: (what: string, date: string) => `A note about my ${what.toLowerCase()} on ${date}: `,
  book: "I’d like to book my next visit.",
  bookFirstFit: "I’d like to book my first fit.",
  bookReplacement: "I’d like to book my replacement hair system.",
  document: (what: string, reference: string) => `Please send me the ${what.toLowerCase()} for ${reference}.`,
  // A visit's invoice that has not come in the day it should have.
  lateInvoice: (what: string, date: string) => `Please send me the invoice for my ${what.toLowerCase()} on ${date}.`,
  // A refund that has taken longer than Razorpay's working days.
  lateRefund: (what: string, date: string) => `My refund for ${what.toLowerCase()} from ${date} hasn’t arrived.`,
  // A client moving to another city while a visit is booked.
  moveCity: "I’m moving to another city and have a visit booked.",
} as const;

export const empty = {
  photos: {
    title: "Photos",
    lines: ["Your photos start at your first visit.", "Five angles at every visit, taken for your visit record."],
  },
  payments: {
    title: "Payments",
    lines: ["Nothing to pay yet.", "Your consultation is free. Later payments appear here with their invoices."],
  },
  // A consultation and fit in one visit, booked with nothing paid.
  paymentsOneVisit: {
    title: "Payments",
    lines: ["Nothing to pay yet.", "You pay once fitted, by a link we text you."],
  },
  // The design draws the empty list for a lead only.
  paymentsFitted: {
    title: "Payments",
    lines: ["No payments yet.", "Payments made in the app appear here with their invoices."],
  },
  refer: {
    title: "Refer",
    lines: notYetFittedLines,
  },
} as const;

/** The states screen: loading, offline and error. */
export const states = {
  loading: "Loading",
  /** On Home, which the phone keeps. */
  offline: "No connection. Showing your last update.",
  // On a page the phone does not keep.
  offlineOnly: "No connection.",
  waiting: "This page will load when you are back online.",
  error: {
    title: "We couldn’t load your visit.",
    /** Said only when the phone has kept a Home with a visit on it. */
    booked: "Your visit is still booked.",
    retry: "Try again",
    message: "Message us",
  },
} as const;

export const errors = {
  // The design draws no error for the profile.
  load: "We couldn’t load this. Try again.",
  retry: "Try again",
} as const;

/** A page that failed to draw, which React would otherwise leave blank. */
export const broken = {
  // The design draws no page that failed.
  message: "This page didn’t open.",
  reload: "Reload",
  home: "Home",
} as const;

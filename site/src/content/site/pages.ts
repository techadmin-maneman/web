// The other pages: /book, the stop page, the page not found, and each page's title and description.

import { serviceArea, visitLength } from "../service.ts";
import { tryOnTeaser } from "./home.ts";

/**
 * The site's own booking page, the referral landing without its invite (docs/decisions/0051-booking-from-the-site.md).
 * The form's words are the landing's (referral.ts); these are the page's own.
 */
export const booking = {
  /** The page's heading follows what the form books, and where we do not come yet, the waitlist. */
  title: "Book a free consultation",
  titleOneVisit: "Book a consultation and fit",
  titleWaitlist: "Not in your area yet",
  intro: `Your technician measures your scalp and matches your colour: ${visitLength.consultation}, free. Or add the fit and wear your hair system the same day.`,
  /** Where we do not come yet: what the list is for. */
  introWaitlist: "Join the list and we’ll WhatsApp you the week we start coming to you.",
  extent: "Extent of hair loss (optional)",
  /**
   * Not drawn: the page's steps, the name and number first, kept before anything else
   * (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
   */
  step: "Step {at} of {of} · {name}",
  steps: { you: "You", area: "Your area", visit: "Your visit", address: "Your address", list: "The list" },
  next: "Continue",
  saving: "One moment…",
  /** Beneath the first step, the name and number it kept, and the way back to them. */
  bookingFor: "For {name}, +91 {mobile}",
  changeYou: "Change",
  changeYouLabel: "Change your name or number",
  waitlistTitle: "Join the list",
};

// ---------------------------------------------------------------------------
// Other pages
// ---------------------------------------------------------------------------

export const notFound = {
  title: "This page isn’t here.",
  body: "The address may have changed. Everything is on the home page.",
  home: "Back to the site",
};

/**
 * The page the link at the foot of a reminder or the launch alert opens. "Done" names what
 * stopped. "{whatsapp}" is the business number, as a chat link.
 */
export const stopMessages = {
  ask: {
    title: "Stop these messages",
    body: "One tap, and we stop sending them on WhatsApp.",
    button: "Stop them",
  },
  done: {
    title: "Done.",
    whatsapp_visits: "We’ll only message you on WhatsApp about payments and refunds, and call you about any change to a visit.",
    whatsapp_launches: "We won’t message you when we come to a new area any more.",
    again: "Changed your mind? Switch them back on in the Mane Man app, or message us at {whatsapp}.",
  },
  expired: {
    title: "This link no longer works.",
    body: "Reply STOP to any of our WhatsApp messages, or message us at {whatsapp}, and we will stop them.",
  },
  offline: "We couldn’t reach Mane Man. Check your connection and try again.",
};

export const pageTitles = {
  home: `Mane Man — hair systems, fitted at your home across ${serviceArea}`,
  tryOn: "Try a new look — Mane Man",
  book: "Book a free consultation — Mane Man",
  privacy: "Privacy — Mane Man",
  terms: "Terms — Mane Man",
  notFound: "Not found — Mane Man",
  stop: "Stop messages — Mane Man",
};

/** Each page's description, for search results and shared links. */
export const pageDescriptions = {
  home: `Hair systems in 100% real human hair, fitted at your home across ${serviceArea}. The consultation is free.`,
  tryOn: tryOnTeaser.body,
  book: booking.intro,
  privacy: "What Mane Man keeps about you, who processes it, how long it is kept, and how to have it erased.",
  terms: "The terms of Mane Man’s hair system service.",
};

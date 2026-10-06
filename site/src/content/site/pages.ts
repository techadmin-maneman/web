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
  extent: "Extent of hair loss (optional)",
};

// ---------------------------------------------------------------------------
// Other pages
// ---------------------------------------------------------------------------

export const notFound = {
  title: "This page is not here.",
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
    whatsapp_visits: "We won’t message you on WhatsApp about your visits any more. We’ll call you about any change.",
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
  terms: "The terms of Mane Man's hair system service.",
};

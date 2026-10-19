// The other pages: /book, the stop page, the page not found, and each page's title and description.

import { serviceArea, visitLength } from "../service.ts";
import { tryOnTeaser } from "./home.ts";

/**
 * The site's own booking page, the referral landing without its invite (docs/decisions/0051-booking-from-the-site.md).
 * The form's words are the landing's (referral.ts); these are the page's own.
 */
export const booking = {
  /** The page's heading follows what the form books, and where we do not come yet, the waitlist. */
  title: "Meet your hair again. Completely private, right at home.",
  titleOneVisit: "Book a consultation and fit",
  titleWaitlist: "Not in your area yet",
  intro: [
    `In just ${visitLength.consultation}, a specialist measures, colour-matches and custom-maps your hairline at your home, completely free. And you get to see a demo of how your hairline would look with the right system in place.`,
    "Love what you see? You can even get it fitted and walk out with a full head of hair the very same day.",
  ],
  /** Where we do not come yet: what the list is for. The WhatsApp is the visitor's to tick, so it is promised as so. */
  introWaitlist: "Join the list. Tick the box and we’ll WhatsApp you the week we start coming to you.",
  /**
   * The page's steps, the name and number first, kept before anything else
   * (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
   */
  step: "Step {at} · {name}",
  steps: { you: "About you", area: "Your area", visit: "Your visit", address: "Your address", list: "The list" },
  /** The first step's button, which keeps the name and number before the pincode is asked. Its arrow keeps to the last word. */
  start: "Book your free consultation\u00a0→",
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
    whatsapp_visits:
      "We’ll only message you on WhatsApp about payments and refunds, and call you about any change to a visit.",
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
  notices: "Notices — Mane Man",
  notFound: "Not found — Mane Man",
  stop: "Stop messages — Mane Man",
};

/** Each page's description, for search results and shared links. */
export const pageDescriptions = {
  home: `Hair systems in 100% real human hair, fitted at your home across ${serviceArea}. The consultation is free.`,
  tryOn: tryOnTeaser.body,
  book: booking.intro.join(" "),
  privacy: "What Mane Man keeps about you, who processes it, how long it is kept, and how to have it erased.",
  terms: "The terms of Mane Man’s hair system service.",
  notices: "What each agreement on Mane Man’s site and app covers: the try-on, your photos and WhatsApp.",
};

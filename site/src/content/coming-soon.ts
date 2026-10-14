// What maneman.in shows until the site goes live there (PRODUCTION_LIVE, site/src/lib/flags.ts): the brand, a line,
// and WhatsApp to be told when it opens. It is built outside Astro (scripts/build/coming-soon.ts), so the Words page
// does not reach it.

export const comingSoon = {
  title: "Mane Man",
  heading: "A full head of hair, matched to your own.",
  body: "Hair systems, fitted at home by a trained technician. Opening soon.",
  waitlist: "Tell me when you open",
  /** What the visitor's WhatsApp writes for them, ready to send. */
  waitlistMessage: "Hello, please tell me when Mane Man opens.",
  notFound: "Nothing here yet.",
  home: "Back to Mane Man",
};

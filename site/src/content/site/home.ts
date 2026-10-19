// The home page, its header, sticky bar and footer, section by section.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { capitalised, serviceArea, visitLength } from "../service.ts";

export const header = {
  /** The first thing a keyboard reaches, past the header to the page. */
  skip: "Skip to content",
  homeLabel: "Mane Man, home",
  /** What a screen reader calls the header's links. */
  navLabel: "Sections",
  nav: [
    { label: "What it is", href: "/#what" },
    { label: "The range", href: "/#range" },
    { label: "Questions", href: "/#faq" },
  ],
  area: serviceArea,
  book: "Book a free consultation",
  /** The same button on a phone, where the full words would run into the wordmark. */
  bookShort: "Free consultation",
};

export const stickyBar = {
  /** What a screen reader calls the bar's landmark. */
  label: "Book or message us",
  whatsappLabel: "Message us on WhatsApp",
  book: "Book a free consultation",
};

export const footer = {
  /** Beneath the wordmark, then the way to book. */
  tagline: "A full head of hair, matched to your own. Fitted at home.",
  book: header.book,
  columns: {
    service: {
      title: "Service",
      links: [
        { label: "What it is", href: "/#what" },
        { label: "The range", href: "/#range" },
        { label: "Try-on", href: "/try" },
        { label: "Questions", href: "/#faq" },
      ],
    },
    /** The guides and the cities, once they are published (site/src/lib/more-pages.ts). */
    more: { title: "Learn" },
    reach: { title: "Reach us" },
    legal: {
      title: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
    },
  },
  /** The slim footer on every other page: where to go from there, before the notices. */
  pagesLabel: "Pages",
  pages: [
    { label: "Home", href: "/" },
    { label: "Try-on", href: "/try" },
  ],
  area: `${serviceArea} · home service only`,
  entity: "Mane Man Private Limited",
  /** Before the company's name, with the year the page was built. */
  copyright: "©",
};

export const placeholderTag = "Placeholder";

/** On a picture made by AI rather than taken of a client. */
export const illustrationTag = "Illustration";

// ---------------------------------------------------------------------------
// Home, in order
// ---------------------------------------------------------------------------

export const hero = {
  /** Shown one at a time over the footage, round and round. */
  sequence: [
    "Natural up close.",
    "100% real human hair.",
    "Fitted at home.",
    "Get your confident self back.",
    "Be the Main Man again.",
  ],
  title: "A full head of hair, matched to your own.",
  body: "Your technician comes when it suits you, matches a hair system to your own hair and fits it.",
  tryOn: "Try a new look",
  book: "Book a free consultation",
  // The footage and the opening line loop, so both can be stopped (WCAG 2.2.2).
  pause: "Pause",
  play: "Play",
};

/** The before and after beneath the hero, a pair at a time. Its pairs are in media.ts (resultPairs). */
export const results = {
  title: "10,000+ transformations by our specialists. Quietly.",
  /** What a screen reader calls the section. */
  label: "Before and after",
  before: "Before",
  after: "After",
  /** Where the pair shown stands among them: "1 of 4". */
  count: "{at} of {count}",
  previous: "Previous",
  next: "Next",
  /** The compare's name, apart from the try-on teaser's. */
  sliderLabel: "Compare this client’s before and after",
};

export const whatItIs = {
  title: "What it is",
  body: "A fine base of lace, mono or skin, with 100% real human hair tied in strand by strand. Shaped to your scalp, matched to your own hair, and bonded to the skin. It is not a wig.",
  statement: "You sleep in it, shower in it, train in it.",
};

export interface NorwoodStage {
  readonly numeral: string;
  readonly name: string;
  readonly tag: string;
  /** The line drawing's bald region (the design's _nwOld), used when norwoodPhotos.use is "drawings". */
  readonly bald: string;
}

const NORWOOD_FRONT = {
  iii: "M96 0 L96 30 C88 21 76 15 60 13 L53 0 Z",
  iv: "M96 0 L96 32 C87 21 73 15 55 13 L47 0 Z",
  v: "M96 0 L96 35 C85 22 69 15 49 14 L40 0 Z",
  vi: "M0 0 L96 0 L96 37 C80 20 46 12 26 27 C16 35 10 47 8 61 L0 61 Z",
  vii: "M0 0 L96 0 L96 45 C80 27 44 18 22 35 C12 45 6 59 5 74 L0 74 Z",
};
const NORWOOD_VERTEX = {
  sm: " M45 27 C51 27 54 23 54 18 C54 13 50 10 45 10 C40 10 36 13 36 18 C36 23 39 27 45 27 Z",
  md: " M42 31 C50 31 56 25 56 19 C56 12 50 8 42 8 C34 8 28 12 28 19 C28 25 34 31 42 31 Z",
};

export const norwood = {
  title: "Where you are on the scale",
  intro: "Hair loss in men is graded in seven stages.",
  label: "Stages III to VII · we fit all five",
  stages: [
    { numeral: "III", name: "A clear M", tag: "We fit", bald: NORWOOD_FRONT.iii },
    { numeral: "IV", name: "Front and crown", tag: "We fit", bald: NORWOOD_FRONT.iv + NORWOOD_VERTEX.sm },
    { numeral: "V", name: "The bridge narrows", tag: "We fit", bald: NORWOOD_FRONT.v + NORWOOD_VERTEX.md },
    { numeral: "VI", name: "The bridge is gone", tag: "We fit", bald: NORWOOD_FRONT.vi },
    { numeral: "VII", name: "A rim only", tag: "We fit", bald: NORWOOD_FRONT.vii },
  ] satisfies NorwoodStage[],
  /** The last card: a hairline restored, after the five stages. Its picture is media.ts's norwoodRestored. */
  restored: `From these to this in ${visitLength.firstFit}.`,
  book: "Book a free consultation",
};

/** A comparison cell: text, or a tick (true) or cross (false). */
export type ComparisonCell = string | boolean;

export const comparison = {
  title: "Why choose a hair system",
  intro: "How a hair system compares.",
  columns: ["Transplant", "Medication", "Hair system"],
  yes: "Yes",
  no: "No",
  rows: [
    {
      label: "Cost",
      // The other treatments' typical costs; ours is never given (THEIRS, src/lib/publish-gate.ts).
      cells: [
        "Rs. 1.2–3 lakh, very often repeated",
        "Rs. 20,000–50,000 a year, for life",
        "Quoted free, before anything is fitted",
      ],
    },
    { label: "Visible result", cells: ["9–12 months", "6–9 months", "The same day"] },
    { label: "Covers advanced loss", cells: [false, false, true] },
    { label: "No surgery", cells: [false, true, true] },
    {
      label: "Side effects",
      cells: ["Surgical risks", "Long-term side effects", "Nothing implanted or swallowed"],
    },
    { label: "Reversible", cells: [false, true, true] },
    {
      label: "Upkeep",
      cells: ["Loss carries on; repeats are common", "Daily, for life", "A service visit every 2 to 4 weeks"],
    },
  ] satisfies { label: string; cells: [ComparisonCell, ComparisonCell, ComparisonCell] }[],
};

export const tryOnTeaser = {
  eyebrow: "Try-on",
  title: "See yourself with hair.",
  // The look on WhatsApp only is ADR 0104's.
  body: "One photo, one look from six, sent privately to your WhatsApp.",
  start: "Start the try-on",
  before: "Before",
  after: "After",
  sliderLabel: "Compare before and after",
  /** What a screen reader hears as the handle moves. */
  sliderValue: "{before}% before, {after}% after",
  /** Where the handle starts: the one place the teaser's stylesheet draws it before the page runs. */
  start_percent: 46 as const,
};

export const discretionBand = {
  text: `${capitalised(visitLength.firstFit)} at your own table, and nobody else need ever know.`,
};

export const howItWorks = {
  title: "How it works",
  steps: [
    {
      number: "01",
      title: "Consultation at home",
      body: "Your scalp measured, your colour matched in daylight, and your hair system chosen with you. Then see how one looks on you, for real.",
      meta: `${capitalised(visitLength.consultation)} · free`,
    },
    {
      number: "02",
      title: "The first fit",
      body: "The same visit or a later one: your choice. Bonded, cut into your own hair and styled. Confidence, delivered.",
      meta: `${capitalised(visitLength.firstFit)} · at your home`,
    },
    {
      number: "03",
      title: "Regular service visits",
      body: "Every month, or every two weeks on Celebrity: lifted, cleaned, re-bonded and trimmed to your own growth.",
      meta: `${capitalised(visitLength.service)} · at your home`,
    },
  ],
};

/**
 * The four hair systems side by side, as the product guide compares them (6 October 2026). It gives no price; how long
 * each lasts is the guide's figure (ADR 0215).
 */
export const range = {
  title: "The range",
  intro: "Four hair systems, every one 100% real human hair. Your technician helps you choose.",
  products: [
    { name: "Mane Man Essential", short: "Essential" },
    { name: "Mane Man Active", short: "Active" },
    { name: "Mane Man Natural", short: "Natural" },
    { name: "Mane Man Celebrity", short: "Celebrity" },
  ],
  rows: [
    { label: "Made for", cells: ["Everyday wear", "The gym and sport", "A visible parting", "A close look"] },
    { label: "Base", cells: ["Fine mono", "French lace", "Silk over lace", "Thin skin"] },
    { label: "Hairline", cells: ["Good", "Very good", "Very good", "Best"] },
    { label: "Breathes", cells: ["Moderate", "Highest", "Lowest", "Low"] },
    { label: "Lasts", cells: ["8 months", "6 months", "6 months", "4 months"] },
    { label: "Service visit", cells: ["Monthly", "Monthly", "Monthly", "Twice a month"] },
  ] satisfies { label: string; cells: [string, string, string, string] }[],
};

export const guarantee = {
  label: "The guarantee",
  text: GUARANTEE,
};

export const faq = {
  title: "Questions",
  intro: { before: "If yours isn’t here, ", link: "ask on WhatsApp", after: "." },
  items: [
    {
      q: "Will anyone be able to tell?",
      a: "Not at conversational distance. The hairline is where it is won or lost, and every hair system we fit has a lace front that melts into the skin. Under a shower, or with a hand run back through the hair, someone could tell.",
    },
    {
      q: "How long does a hair system last?",
      a: "Months, not years: the base wears out before the hair does. How many depends on the base you choose, the heat and your care, and your technician tells you what to expect from yours. A service visit every two to four weeks keeps it at its best.",
    },
    {
      q: "What happens at a service visit?",
      a: `The technician lifts the hair system, cleans the adhesive off the base and your scalp, checks the knots, re-bonds it and trims the hair to match your own growth. About ${visitLength.service}, at your home.`,
    },
    {
      q: "Can I swim, shower and exercise with it?",
      a: "Yes to all three. Chlorine and sea salt shorten the life of the base, so rinse it in fresh water afterwards. Heavy sweating is fine.",
    },
    {
      q: "Does it damage the hair I still have?",
      a: "The base sits on skin, not on hair, and the perimeter is bonded to areas where you have little or none. Hair under the base is trimmed short rather than shaved.",
    },
    {
      q: "How do you match the colour and the hairline?",
      a: "Colour is matched against forty samples in daylight at the consultation, including the grey percentage. The hairline is drawn on your forehead with a pencil and agreed with you before anything is fitted.",
    },
    {
      q: "What if I don’t like it?",
      a: `Say so before it’s fitted and you pay nothing. Once it’s fitted: ${GUARANTEE.charAt(0).toLowerCase()}${GUARANTEE.slice(1)}`,
    },
    {
      q: "Which cities do you cover?",
      // As built, naming no city; the site's Worker writes in the cities ops serve (site/src/lib/cities.ts).
      a: "We come by pincode. Check yours on the booking page; if we’re not there yet, leave your number and we’ll tell you when we are.",
      cities:
        "We’re in {cities}, by pincode. Check yours on the booking page; if we’re not there yet, leave your number and we’ll tell you when we are.",
    },
    {
      q: "What does it cost?",
      a: "It depends on the hair system you choose. Your technician quotes it at the free consultation, before anything is fitted. No deposit, no package.",
    },
    {
      q: "Is this the same thing as a wig?",
      a: "No. A wig sits on the whole head, is held by tension or clips, and comes off at night. This is bonded to the skin over the area you have lost, is cut to your face, and stays on for weeks at a time.",
    },
  ],
};

export const closing = {
  title: `The consultation takes ${visitLength.consultation} and costs nothing.`,
  book: "Book a free consultation",
};

// ---------------------------------------------------------------------------
// Try-on (/try)
// ---------------------------------------------------------------------------

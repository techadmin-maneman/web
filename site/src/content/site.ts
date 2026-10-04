// Every string and image on the site, taken word for word from the design
// (design/Mane Man Site v2.dc.html), except where the owner rewrote the home
// page on 1 October 2026 (docs/decisions/0103-the-home-pages-first-copy-round.md).
// Components hold no copy of their own.
//
// Some entries need care before production (docs/frontend.md):
//
// - Placeholder blocks carry `publish`. They hold the design's placeholder
//   material and render in staging with the design's "Placeholder" tag. In
//   production only published blocks render, and the build stops if a
//   published block still holds the design's material (design-placeholders.ts).
// - Notices carry the version recorded with a consent, and `approved`. The
//   wording itself is the backend's (src/config/notices.ts), so the page and
//   the consent record can never disagree. The production build stops while
//   any notice is unapproved, and a new version is unapproved until it is
//   added to APPROVED_NOTICES.
// - The legal pages carry `approved` too: the production build stops until
//   counsel has signed their wording off.
// - Prices are holes, "{firstFit}, then {service} a month", which the price
//   book fills (src/lib/prices.ts, docs/decisions/0073-prices-from-the-price-book.md).
//   The production build stops on a price typed into a sentence.
//
// Images are file names in design/assets; src/lib/images.ts resolves them.
// `{city}` and similar are filled in by the page.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { WHATSAPP_NUMBER } from "@maneman/web-kit/whatsapp";
import { LOSS_EXTENTS, type LossExtent } from "../../../src/config/booking.ts";
import { CURRENT_NOTICE, findNotice, LANDING_NOTICES } from "../../../src/config/notices.ts";
import { PRESETS, type PresetId } from "../../../src/config/presets.ts";
import { KEEPING_NOTICES } from "../../../src/policy/kept-try-ons.ts";
import { capitalised, serviceArea, visitLength } from "./service.ts";

export interface Picture {
  readonly file: string;
  readonly alt: string;
}

export interface Notice {
  readonly version: string;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly lines: readonly string[];
}

/**
 * The versions approved word for word: the try-on's three by the owner on 22 September 2026, and the consents,
 * the landing's among them, by counsel the same day (ADR 0025, item 25).
 */
const APPROVED_NOTICES: readonly string[] = [
  "photo-v1",
  "gate-v1",
  "referral-consultation-v1",
  "waitlist-v1",
  "whatsapp-launches-v1",
];

function notice(version: string): Notice {
  const found = findNotice(version);
  if (found === undefined) throw new Error(`no notice ${version} in src/config/notices.ts`);
  return { version, approved: APPROVED_NOTICES.includes(version), lines: found.text };
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

/**
 * Every notice the site shows, which the production build refuses unless each is approved. The try-on's two say its
 * look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), and every build shows them,
 * so production's build waits for counsel to approve them (docs/open-points.md, item 146).
 */
export const notices = {
  /** The try-on consent screen. */
  photo: notice(CURRENT_NOTICE.tryon_photo),
  /** The try-on gate. */
  gate: notice(CURRENT_NOTICE.result_delivery),
  /** The booking form's agreement, on /book and /r/:code. */
  consultation: notice(LANDING_NOTICES.consultation),
  /** The waitlist's required agreement. */
  waitlist: notice(LANDING_NOTICES.waitlist),
  /** The waitlist's optional launch alert. */
  launchAlert: notice(CURRENT_NOTICE.whatsapp_launches),
} as const;

/**
 * The site sends the photograph's small copy only under a photo notice that says a client keeps it
 * (docs/decisions/0084-a-clients-try-on-is-kept.md).
 */
export const tryOnSendsCopy = KEEPING_NOTICES.includes(notices.photo.version);

// ---------------------------------------------------------------------------
// Placeholder blocks
// ---------------------------------------------------------------------------

const WHATSAPP_DISPLAY = "+91 90079 73247";

/** The business WhatsApp number: the footer's, the legal pages', and every wa.me link. */
export const whatsapp = {
  publish: true,
  number: WHATSAPP_NUMBER,
  display: WHATSAPP_DISPLAY,
  label: `WhatsApp · ${WHATSAPP_DISPLAY}`,
};

export const heroFootage = {
  publish: false,
  video: "hero.mp4",
  /**
   * The same film for phones: its centre, upright, without sound, under 800 KB. Made from `video` with
   * ffmpeg -i hero.mp4 -vf crop=406:720 -an -c:v libx264 -preset slow -crf 24 -movflags +faststart hero-phone.mp4
   */
  phoneVideo: "hero-phone.mp4",
  poster: "hero-poster.jpg",
  tag: "Placeholder footage",
};

export const whatPlate = {
  publish: false,
  image: {
    file: "membrane-on-skin.jpg",
    alt: "A hair-system membrane laid against scalp skin, individual hairs passing through it",
  },
};

export const norwoodPhotos = {
  publish: false,
  /** Where the photographs are not cleared, the line-drawn profiles stand in: "photos" or "drawings". */
  use: "photos" as "photos" | "drawings",
  images: [
    { file: "nw-1.jpg", alt: "A man at Norwood stage I, seen in three-quarter view" },
    { file: "nw-2.jpg", alt: "A man at Norwood stage II, seen in three-quarter view" },
    { file: "nw-3.jpg", alt: "A man at Norwood stage III, seen in three-quarter view" },
    { file: "nw-4.jpg", alt: "A man at Norwood stage IV, seen in three-quarter view" },
    { file: "nw-5.jpg", alt: "A man at Norwood stage V, seen in three-quarter view" },
    { file: "nw-6.jpg", alt: "A man at Norwood stage VI, seen in three-quarter view" },
    { file: "nw-7.jpg", alt: "A man at Norwood stage VII, seen in three-quarter view" },
  ] satisfies Picture[],
};

/** The before/after pair in the try-on teaser. */
export const teaserPair = {
  publish: false,
  before: { file: "ba-before.jpg", alt: "Before, crown thinning" },
  after: { file: "ba-after.jpg", alt: "After a hair system is fitted" },
};

export const stepPhotos = {
  publish: false,
  images: [
    { file: "step-02-template.jpg", alt: "Hands laying strips of tape over cling film on the crown of a head" },
    { file: "step-03-fit.jpg", alt: "Barber’s scissors trimming hair at a bonded hairline" },
    {
      file: "step-04-kit.jpg",
      alt: "A technician’s canvas tool roll laid open, scissors, comb, adhesive remover and brush in order",
    },
  ] satisfies Picture[],
};

/** Two of the base materials up close, in "Materials and construction". */
export const basePhotos = {
  publish: false,
  images: [
    {
      file: "base-monofilament.jpg",
      alt: "Macro of a monofilament mesh base with hairs hand-tied into it as visible knots",
    },
    {
      file: "base-thinskin.jpg",
      alt: "Macro of a thin polyurethane base held between finger and thumb, hair passing through it",
    },
  ] satisfies Picture[],
};

export const technicians = {
  publish: false,
  title: "Who comes to your home",
  yearsLabel: "years fitting",
  fitsLabel: "fits completed",
  people: [
    {
      name: "Imran Qureshi",
      photo: { file: "tech-1.jpg", alt: "Imran Qureshi, hair-system technician" },
      years: "11",
      fits: "1,400",
    },
    {
      name: "Sandeep Rawat",
      photo: { file: "tech-2.jpg", alt: "Sandeep Rawat, hair-system technician" },
      years: "8",
      fits: "900",
    },
    {
      name: "Vikas Chauhan",
      photo: { file: "tech-3.jpg", alt: "Vikas Chauhan, hair-system technician" },
      years: "6",
      fits: "600",
    },
  ],
};

export const testimonials = {
  publish: false,
  title: "What clients say",
  intro: "Three men who had a system fitted at home in the last year.",
  quotes: [
    {
      photo: { file: "client-1.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "He came on a Sunday morning and was finished by eleven. I had a wedding that week and nobody said a word about my hair.",
      name: "Client name",
      meta: "Age · Norwood IV · Gurgaon",
    },
    {
      photo: { file: "client-2.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "The first fit took about ninety minutes. What I did not expect was the monthly visit — he lifts it, cleans the base, re-cuts it, and is gone inside an hour.",
      name: "Client name",
      meta: "Age · Norwood V · Noida",
    },
    {
      photo: { file: "client-3.jpg", alt: "Portrait of a Mane Man client" },
      quote:
        "I asked what happens if I hate it. He gave me the fourteen-day terms before taking any money, which is why I went ahead.",
      name: "Client name",
      meta: "Age · Norwood III · Delhi",
    },
  ],
};

export const founderNote = {
  publish: false,
  label: "A note from the founder",
  paragraphs: [
    "I started losing my hair at twenty-six. By thirty I had been to four clinics, and not one would tell me a price before I was sitting in the chair with a consultant beside me.",
    "So Mane Man does two things differently. The technician comes to your home, so nobody sees you walk into anywhere. And every price is on this page, so you can decide before you speak to us.",
  ],
  signature: "Founder, Mane Man",
};

/**
 * The privacy page's sentences on the try-on: its look goes to WhatsApp only, and a client's try-on is kept
 * (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md, 0084-a-clients-try-on-is-kept.md).
 */
// PLACEHOLDER: the try-on's sentences await counsel with the notices (docs/open-points.md, item 146).
const TRY_ON_PRIVACY =
  "If you use the try-on, your photograph is used to make your simulation. It is sent to AILabTools, the service that generates it, we never use it to train any model, and it is deleted within thirty days, usually within the hour. Before the simulation is made, you give us your name and mobile number: we send the simulation to that number on WhatsApp, and it is never shown on this site; the simulation itself is kept for fourteen days. If you then book a visit while the simulation is kept, we keep a small copy of your photograph in your Mane Man account as your before photo, until you ask us to delete it, and the simulation until the photographs of your first fit are taken; you see both when you sign in.";

interface LegalSection {
  readonly heading: string;
  /** "{whatsapp}" in a paragraph is the business number, shown as a link to a WhatsApp chat. */
  readonly paragraphs: readonly string[];
}

export interface LegalPage {
  readonly publish: boolean;
  /** Counsel has signed off this wording. */
  readonly approved: boolean;
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

/** The two long-form pages, a heading per topic. Their Phase 2 wording is a draft for counsel. */
export const legalPages: { readonly privacy: LegalPage; readonly terms: LegalPage } = {
  privacy: {
    publish: true,
    approved: false,
    title: "Privacy",
    sections: [
      {
        heading: "What we keep",
        paragraphs: [
          "Mane Man Grooming Services Private Limited collects only what it needs to arrange your visits and your simulation. When you book, we keep your name, mobile number, the address the visit is at, preferred visit time and the extent of your hair loss, with how you reached this site.",
          "Once you are a client, we also keep what your visits need: the photographs taken at each visit; your hair profile, which records your fit and what you tell us of treatments you have tried, skin conditions and allergies; and your visits, payments, refunds and credits.",
        ],
      },
      {
        heading: "Who holds it",
        paragraphs: [
          // PLACEHOLDER: counsel sees this wording, which no longer names Zoho FSM, before production (docs/open-points.md, item 149).
          "Your details are held in our own database, hosted by Cloudflare, where your visits are arranged, and in the customer system our team works from, Zoho CRM. Your hair profile stays in our own database. Payments are made through Razorpay. Our invoices are kept in Zoho Books, made out to your name, number and address.",
          "We use your details to arrange and look after your visits, and for anything else only with your agreement, which you can withdraw in the app or by messaging us at {whatsapp}. To stop our WhatsApp messages, reply STOP to any of them. We never sell your details.",
        ],
      },
      {
        heading: "The try-on",
        paragraphs: [
          TRY_ON_PRIVACY,
          // PLACEHOLDER: the try-on's cookie sentence awaits counsel with its notices (docs/open-points.md, item 146).
          "The site sets one cookie of its own, for the try-on: it remembers for thirty days that this browser has had its one look.",
        ],
      },
      {
        heading: "Invites and analytics",
        paragraphs: [
          // PLACEHOLDER: the invite's sentence awaits counsel (docs/open-points.md, item 156).
          "When you open a friend's invite, this browser keeps the invite's code for thirty days, so that a consultation you book here later still comes with it; it is removed once a booking has used it, or on your first visit after the thirty days.",
          "We count visits with Cloudflare Web Analytics, and measure our advertising with Google Analytics, Google Ads and Meta, which set their own cookies and never receive your name, number or photograph. Visitors' network addresses are kept only in scrambled form, to limit abuse.",
        ],
      },
      {
        heading: "How long we keep it",
        paragraphs: [
          // PLACEHOLDER: the periods the owner ruled on 2 October 2026, for counsel to confirm (docs/open-points.md, item 149).
          "Once you are a client, we keep your details, your address and your visit photographs until you ask us to erase them. If you never book a visit or pay us, we erase your details a year after you last used the site or the app. A waitlist place goes a year after we launch in your area. Where a technician checked in at your door is kept only until a no-show charge can no longer be disputed. Invoices are kept for eight years, as the law requires.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "Under India's Digital Personal Data Protection Act, 2023, you can ask what we hold about you, have it corrected, or have it erased. In the app you can download your data, correct your details and ask us to delete your account; anyone can message us on WhatsApp at {whatsapp}.",
          "We decide a request to erase within seven days. Erasing deletes your photographs and clears your name, number and address from our records; your visits, payments and invoices stay as records. If a visit is still booked, or we hold a payment of yours, we settle that first.",
        ],
      },
    ],
  },
  terms: {
    publish: true,
    approved: false,
    title: "Terms",
    sections: [
      {
        heading: "These terms",
        paragraphs: [
          "These terms cover the service Mane Man Grooming Services Private Limited provides: non-surgical hair systems, measured, fitted and serviced at your home across Delhi NCR. By booking a visit or using the try-on you agree to them. We may change them; the version on this page when you book is the one that applies to that booking.",
        ],
      },
      {
        heading: "Your visits",
        paragraphs: [
          "The first visit is a consultation: an hour, free, and with no obligation to order. Nothing is fitted at it. If you book the consultation and fit in one visit instead, which takes three hours, you choose your hair system with your technician, who fits it, and you pay only once fitted; if you decide against it, you pay nothing. We confirm each visit on WhatsApp.",
        ],
      },
      {
        heading: "Prices and payment",
        paragraphs: [
          "Prices include GST, and are the ones shown before you pay. A visit you book in the app is paid when you book it, by UPI or card; a consultation and fit in one visit is paid once you are fitted. A first fit covers the hair system, the fitting and the cut. Your technician never handles money. We take no deposit and sell no package.",
        ],
      },
      {
        heading: "Moving and cancelling",
        paragraphs: [
          "You can move or cancel a visit in the app. Until the time the app shows when you book, that is free: your payment carries over to the new visit or is refunded, and a credit comes back. After that, the late terms the app shows before you confirm apply: the visit may be charged, a late fee kept, or a credit used. If we move a visit, it costs you nothing.",
          "If nobody is home when your technician arrives, the visit may be charged as a late cancellation would be, and you can dispute the charge in the app. A refund reaches the account you paid from in 5 to 7 working days.",
        ],
      },
      {
        heading: "The guarantee",
        paragraphs: [
          "If the fit is not right, we refit it at no charge, or refund you in full, including the fitting and the cut, within fourteen days of the fit. A hair system is bonded to the skin, so tell the technician about any skin condition, allergy or treatment before the fit; if a system is not suitable for you, we say so and do not fit it. A base wears with use and its life depends on its care, so the replacement intervals we give are typical, not promised.",
        ],
      },
      {
        heading: "The try-on",
        paragraphs: [
          // The try-on's sentence on WhatsApp is ADR 0104's, for the owner's second round (docs/open-points.md, item 163).
          "The try-on is an illustrative simulation made by software from one photograph, and sent to the WhatsApp number you give, never shown on this site. It is not a photograph of a result, and not a promise of how your hair system will look: a hair system is matched to your own hair colour, density and growth pattern. Upload only a photograph of yourself, and only if you are eighteen or over. Each visitor gets one simulation.",
        ],
      },
      {
        heading: "Our responsibility",
        paragraphs: [
          "We are responsible for the care and skill of our technicians. Beyond a refit or refund under the guarantee, and except where the law provides otherwise, our liability for a visit is limited to what you paid for it. These terms are governed by the laws of India, and the courts at New Delhi have jurisdiction.",
        ],
      },
      {
        heading: "Questions and complaints",
        paragraphs: ["Message us on WhatsApp at {whatsapp}. Clients can also raise a concern in the app."],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

export const header = {
  homeLabel: "Mane Man, home",
  /** What a screen reader calls the header's links. */
  navLabel: "Sections",
  nav: [
    { label: "What it is", href: "/#what" },
    { label: "The range", href: "/#range" },
    { label: "Questions", href: "/#faq" },
  ],
  area: serviceArea,
  book: "Book a visit",
};

export const stickyBar = {
  /** What a screen reader calls the bar's landmark. */
  label: "Book or message us",
  whatsappLabel: "Message us on WhatsApp",
  book: "Book a visit",
};

export const footer = {
  columns: {
    service: {
      title: "Service",
      links: [
        { label: "What it is", href: "/#what" },
        { label: "The range", href: "/#range" },
        { label: "Try-on", href: "/try" },
      ],
    },
    reach: { title: "Reach us" },
    legal: {
      title: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/terms" },
      ],
    },
  },
  area: `${serviceArea} · home service only`,
  entity: "Mane Man Grooming Services Private Limited",
};

export const placeholderTag = "Placeholder";

// ---------------------------------------------------------------------------
// Home, in order
// ---------------------------------------------------------------------------

export const hero = {
  /** Shown one at a time over the footage, once, settling on the last. */
  sequence: ["Natural up close.", "100% real human hair.", "Fitted at home.", "Be the Main Man again."],
  title: "A full head of hair, fitted at home.",
  body: "Your technician comes when it suits you, matches a hair system to your own hair and fits it.",
  tryOn: "Try a new look",
  book: "Book a free consultation",
  // Not in v2: the footage loops, so it can be stopped (WCAG 2.2.2). The owner approves the words (open point 45).
  pause: "Pause the film",
  play: "Play the film",
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
  readonly description: string;
  /** The line drawing's bald region (v2's _nwOld), used when norwoodPhotos.use is "drawings". */
  readonly bald: string;
}

const NORWOOD_FRONT = {
  ii: "M96 0 L96 26 C90 20 80 15 68 13 L63 0 Z",
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
  early: {
    label: "Stages one and two · nothing to fit yet",
    note: "A system here would cover hair you still have.",
    stages: [
      {
        numeral: "I",
        name: "No recession",
        tag: "No loss",
        description: "The hairline sits where it always has.",
        bald: "M0 0 Z",
      },
      {
        numeral: "II",
        name: "Temple recession",
        tag: "Early",
        description: "The corners have moved back a little. Most men reach this and go no further.",
        bald: NORWOOD_FRONT.ii,
      },
    ] satisfies NorwoodStage[],
  },
  late: {
    label: "Stages three to seven · we can fit all of these",
    stages: [
      {
        numeral: "III",
        name: "A clear M",
        tag: "We fit",
        description: "Deep recession at both temples. The first stage other people notice.",
        bald: NORWOOD_FRONT.iii,
      },
      {
        numeral: "IV",
        name: "Front and crown",
        tag: "We fit",
        description: "The front has gone back further and the crown has opened separately.",
        bald: NORWOOD_FRONT.iv + NORWOOD_VERTEX.sm,
      },
      {
        numeral: "V",
        name: "The bridge narrows",
        tag: "We fit",
        description: "Front and crown are both bare, divided by a thinning band of hair.",
        bald: NORWOOD_FRONT.v + NORWOOD_VERTEX.md,
      },
      {
        numeral: "VI",
        name: "The bridge is gone",
        tag: "We fit",
        description: "Front and crown have joined into one continuous bare area.",
        bald: NORWOOD_FRONT.vi,
      },
      {
        numeral: "VII",
        name: "A rim only",
        tag: "We fit",
        description: "Hair remains as a band around the sides and back of the head.",
        bald: NORWOOD_FRONT.vii,
      },
    ] satisfies NorwoodStage[],
  },
  book: "Book a free consultation",
};

/** A comparison cell: text, or a tick (true) or cross (false). */
export type ComparisonCell = string | boolean;

export const comparison = {
  title: "Why choose a hair system",
  intro: "Two of these are not ours.",
  columns: ["Transplant", "Medication", "Hair system"],
  yes: "Yes",
  no: "No",
  rows: [
    {
      label: "Cost",
      cells: [
        "Rs. 1.2–3 lakh for 4,000–5,000 hairs",
        "Rs. 800–2,000 a month, for life",
        "Quoted at your free consultation",
      ],
    },
    { label: "Visible result", cells: ["9–12 months", "4–6 months", "The same day"] },
    { label: "Covers advanced loss", cells: [false, false, true] },
    { label: "Surgery", cells: [true, false, false] },
    {
      label: "Side effects",
      cells: ["Infection, scarring, shock loss", "Lower libido, scalp irritation", "Nothing implanted or swallowed"],
    },
    { label: "Reversible", cells: [false, true, true] },
    {
      label: "Upkeep",
      cells: ["Loss carries on; often a second transplant in a few years", "Daily, for life", "One visit a month"],
    },
  ] satisfies { label: string; cells: [ComparisonCell, ComparisonCell, ComparisonCell] }[],
};

export const tryOnTeaser = {
  eyebrow: "Try-on",
  title: "See yourself with hair before anyone comes to your home.",
  // The look on WhatsApp only is ADR 0104's, for the owner's second round (docs/open-points.md, item 163).
  body: "One photograph, one look from six, sent privately to your WhatsApp. A simulation, not a photograph of a result. Your photograph is deleted within the hour.",
  start: "Start the try-on",
  before: "Before",
  after: "After",
  sliderLabel: "Compare before and after",
  /** What a screen reader hears as the handle moves. */
  sliderValue: "{before}% before, {after}% after",
  start_percent: 46,
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
      body: "Your scalp measured, your colour matched in daylight, and your hair system chosen with you.",
      meta: `${capitalised(visitLength.consultation)} · free`,
    },
    {
      number: "02",
      title: "The fit",
      body: "The same visit or a later one: your choice. Bonded, cut into your own hair and styled. Your new look, on the spot.",
      meta: `${capitalised(visitLength.firstFit)} · at your home`,
    },
    {
      number: "03",
      title: "Monthly service",
      body: "Lifted, cleaned, re-bonded and trimmed to your own growth, so it looks right every month.",
      meta: `Every month · ${visitLength.service}`,
    },
  ],
};

/** The four hair systems, from the owner's product guide of 30 September 2026. */
export const range = {
  title: "The range",
  intro: "Four hair systems. Every one 100% real human hair.",
  products: [
    {
      name: "Mane Man Essential",
      tagline: "Built for everyday wear. The place to start.",
      body: "Fine mono, the strongest base we fit, with a soft lace hairline.",
    },
    {
      name: "Mane Man Active",
      tagline: "Made for men who sweat.",
      body: "A French lace top, the most breathable base there is, and a bleached lace hairline. For the gym, the field and a Delhi summer.",
    },
    {
      name: "Mane Man Natural",
      tagline: "A hairline that passes a close look.",
      body: "A fine skin base with a bleached lace front. No mesh to see, so the hair seems to grow from your scalp.",
    },
    {
      name: "Mane Man NatMax",
      tagline: "Natural, even at the parting.",
      body: "A silk top over lace hides every knot, so a parting shows scalp, not mesh.",
    },
  ],
};

export interface MaterialItem {
  readonly name: string;
  readonly text: string;
  /** One word for each of its group's `rated` labels, in their order. */
  readonly ratings?: readonly string[];
}

export interface MaterialGroup {
  readonly title: string;
  readonly lead?: string;
  readonly rated?: readonly string[];
  readonly photos?: { readonly publish: boolean; readonly images: readonly Picture[] };
  readonly items: readonly MaterialItem[];
}

/** What a hair system is made of, from the product guide's exhibits, each group closed until it is opened. */
export const materials: { readonly title: string; readonly intro: string; readonly groups: readonly MaterialGroup[] } =
  {
    title: "Materials and construction",
    intro: "What each hair system is made of, and what that means for how it looks, breathes and lasts.",
    groups: [
      {
        title: "The base: lace, mono, skin and silk",
        lead: "The base decides everything: how natural it looks, how cool it feels, how long it lasts. The thinner the base, the better it looks and the sooner it wears.",
        rated: ["Natural look", "Breathes", "Strength"],
        photos: basePhotos,
        items: [
          {
            name: "Lace",
            text: "The finest, softest mesh. Its knots can be bleached until they vanish, which is why every hairline we fit is lace.",
            ratings: ["Best", "Most", "Delicate"],
          },
          {
            name: "Mono",
            text: "Monofilament: a fine, tough mesh. It breathes, takes the most hair, and outlasts every other base.",
            ratings: ["Good", "Well", "Strongest"],
          },
          {
            name: "Skin",
            text: "A clear polyurethane film, 0.08 to 0.10 mm thin. No mesh to see, so the hair seems to grow straight from the scalp.",
            ratings: ["Very good", "Little", "Moderate"],
          },
          {
            name: "Silk, multi-layer",
            text: "Hair knotted onto a lace layer and drawn up through silk, so every knot sits hidden between the two. A parting shows scalp.",
            ratings: ["Best at the parting", "Least", "Protected"],
          },
        ],
      },
      {
        title: "How the hair is tied in: knots and loops",
        lead: "Every hair is tied or looped into the base by hand. How it is tied decides how natural the root looks and how well it holds.",
        rated: ["Natural look", "Shedding", "Durability"],
        items: [
          {
            name: "Single knot",
            text: "One small knot for each hair. Fine and flat, on lace and skin.",
            ratings: ["High", "Low to medium", "Medium"],
          },
          {
            name: "Double knot",
            text: "Each hair knotted twice, for the sides and back of a mono base.",
            ratings: ["Medium", "Low", "High"],
          },
          {
            name: "Bleached knot",
            text: "Knots lightened until they disappear. Only lace takes it, so it is kept for the hairline.",
            ratings: ["Highest at the hairline", "Higher", "Low"],
          },
          {
            name: "V-looped",
            text: "No knot at all: each hair is looped through the skin, so it seems to grow from it.",
            ratings: ["Very high", "Very low", "Low"],
          },
          {
            name: "Injected",
            text: "Hair set into the skin so that it stands up from the root. Made for a parting or a brushed-back style.",
            ratings: ["Very high", "Very low", "High"],
          },
        ],
      },
      {
        title: "The rim and the hairline",
        lead: "The edges are where a hair system is held, and where it is seen.",
        items: [
          {
            name: "Clear PU rim",
            text: "A thin, transparent polyurethane edge. The tape grips it, never the mesh, and it disappears at the temples.",
          },
          {
            name: "NPU rim",
            text: "Polyurethane reinforced with mesh: stronger and slightly thicker, so it is kept to the sides and back, where nobody looks.",
          },
          {
            name: "Lace front",
            text: "Up to an inch of lace along the hairline, its knots bleached until they disappear. It is what lets a hairline pass a close look, and every hair system we fit has one.",
          },
        ],
      },
      {
        title: "How much hair: density",
        lead: "Density is how much hair is tied in, against a full natural head. More is not better: too much hair is what gives a hair system away. We match yours to the hair you still have at the sides, not the hair you had at twenty.",
        items: [
          { name: "80% · Light", text: "The scalp shows at a parting. For men over sixty." },
          {
            name: "100% · Medium light",
            text: "Natural, without much volume. Most men's choice, and ours over forty.",
          },
          {
            name: "120% · Medium",
            text: "Visibly fuller, and holds a style. For younger men, and men whose own hair is thick.",
          },
          { name: "140% · Medium heavy", text: "Heavy for daily wear. On request only." },
        ],
      },
      {
        title: "The hair",
        items: [
          {
            name: "100% real human hair",
            text: "Cut, washed and styled like your own. It does not grow, so the hair system is renewed when it wears.",
          },
          {
            name: "Indian remy hair, on Mane Man Natural",
            text: "Every hair runs the same way, root to tip, so it tangles less and holds its shine longer.",
          },
          {
            name: "Matched to you",
            text: "Colour, grey and wave matched to your own hair in daylight, at the consultation.",
          },
        ],
      },
      {
        title: "What we do not fit, and why",
        items: [
          { name: "Ultra-thin skin, 0.03 mm", text: "The most invisible base made, and it lasts about a month." },
          { name: "Full Swiss lace", text: "The most fragile base there is: one to two months." },
          {
            name: "Lace with no rim",
            text: "It must be glued along its whole edge every few weeks: a salon job, not a home service.",
          },
          { name: "140% and denser, as standard", text: "Too much hair is what makes a hair system obvious." },
          { name: "European hair", text: "Finer, dearer, and a poor match for Indian hair." },
        ],
      },
    ],
  };

/**
 * A first fit's price is the cheapest hair system ops offer in the console, and its row and the example say nothing
 * while they offer none.
 */
export const prices = {
  label: "Published prices",
  intro: "No consultation fee, no deposit, no package. You pay for your hair system and the visits you take.",
  column: "Price",
  rows: [
    { label: "First fit", note: "Your hair system, the fitting and the cut", amount: "From {firstFit}" },
    { label: "Monthly service visit", note: "Refit, clean, trim — at your home", amount: "{service}" },
    { label: "Replacement hair system", note: "Every six months", amount: "{replacement}" },
  ],
  example: "Your first year, from {firstYear}: the first fit and twelve service visits at {service}.",
  payment: "Pay by UPI or card: in the app as you book, or by a link once you are fitted.",
  book: "Book a free consultation",
  tryOn: "Or try a new look first",
};

export const guarantee = {
  label: "The guarantee",
  text: GUARANTEE,
};

export const faq = {
  title: "Questions",
  intro: { before: "If yours is not here, ", link: "ask on WhatsApp", after: "." },
  items: [
    {
      q: "Will anyone be able to tell?",
      a: "Not at conversational distance. The hairline is where it is won or lost, and every hair system we fit has a lace front that melts into the skin. Under a shower, or with a hand run back through the hair, someone could tell.",
    },
    {
      q: "How long does a hair system last?",
      a: "Months, not years: the base wears out before the hair does. How many depends on the base you choose, the heat and your care, and your technician tells you what to expect from yours. The monthly visit keeps it at its best.",
    },
    {
      q: "What happens during the monthly service visit?",
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
      q: "What if I do not like it at the fit?",
      a: GUARANTEE,
    },
    {
      q: "Which cities do you cover?",
      a: "All of Delhi NCR: Gurgaon, Delhi, Noida, Faridabad and Ghaziabad. Mumbai and Bengaluru are next. Leave your number and we will tell you when a technician is working in your city.",
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

/** The illustrated stage options, shared by the try-on and the booking form. */
export const stageOptions: readonly {
  readonly id: LossExtent;
  readonly title: string;
  readonly sub: string;
  readonly short: string;
  readonly hair: string;
  readonly zone: string;
}[] = [
  {
    id: "crown",
    title: "Thinning at the crown",
    sub: "The parting has widened",
    short: "Crown thinning",
    hair: "M13 28 C20 17 44 17 51 28",
    zone: "M32 33 C41 33 46 38 46 44 C46 50 40 55 32 55 C24 55 18 50 18 44 C18 38 23 33 32 33 Z",
  },
  {
    id: "receding",
    title: "Receding at the front",
    sub: "The corners have gone back",
    short: "Receding front",
    hair: "M11 34 C16 22 24 18 32 18 C40 18 48 22 53 34",
    zone: "M13 30 C18 19 25 25 32 25 C39 25 46 19 51 30",
  },
  {
    id: "advanced",
    title: "Advanced, front and crown",
    sub: "Little left on top",
    short: "Advanced",
    hair: "M10 40 C14 30 22 26 32 26 C42 26 50 30 54 40",
    zone: "M12 34 C18 16 46 16 52 34 C46 28 18 28 12 34 Z",
  },
];
if (stageOptions.map((stage) => stage.id).join() !== LOSS_EXTENTS.join()) {
  throw new Error("stageOptions must list the backend's LOSS_EXTENTS in order");
}

/**
 * Each look's picture for the look picker, by look id: a file in site/src/assets. The picker draws pictures only
 * once all six looks have one, and until then shows each look's words alone.
 */
const LOOK_PICTURES: Partial<Record<PresetId, string>> = {};

/** The six looks: the backend's presets, in its order. The design splits each label at its first " · ". */
export const looks = PRESETS.map((preset) => {
  const [density = preset.label, ...rest] = preset.label.split(" · ");
  const picture = LOOK_PICTURES[preset.id];
  return { id: preset.id, label: preset.label, density, detail: rest.join(" · "), picture };
});

/** Every look's picture, in the looks' order, or null while any look has none. */
export function lookPictures(list: readonly { readonly picture?: string | undefined }[] = looks): string[] | null {
  const pictures = list.flatMap((look) => (look.picture === undefined ? [] : [look.picture]));
  return pictures.length === list.length ? pictures : null;
}

/** The consent screen's words, from the photo notice: its title, its rows and the agreement. */
export function consentCopy(photo: Notice) {
  const [title = "", ...rest] = photo.lines;
  const agreement = rest.at(-1) ?? "";
  const rows = rest.slice(0, -1).map((line) => {
    const [k = "", ...v] = line.split(": ");
    return { k, v: v.join(": ") };
  });
  return { title, rows, agreement };
}

/** The gate's words, from its notice. */
export function gateCopy(gate: Notice) {
  const [caption = "", title = "", body = "", reassurance = ""] = gate.lines;
  return { caption, title, body, reassurance };
}

/**
 * The try-on's screens. The look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so
 * v2's processing and result screens are gone, the gate asks for the number before the look is made, and the sent
 * and unavailable screens, which v2 does not draw, are ADR 0104's words for the owner's second round
 * (docs/open-points.md, item 163).
 */
export const tryOn = {
  back: "Back",
  backToSite: "Back to the site",
  stepLabels: {
    upload: "Step one of four",
    consent: "Before we begin",
    stage: "Step two of four",
    looks: "Step three of four",
    gate: "Step four of four",
    sent: "Sent to WhatsApp",
    error: "Cannot use this photograph",
  },
  progress: {
    upload: "14%",
    consent: "28%",
    stage: "44%",
    looks: "60%",
    gate: "90%",
    sent: "100%",
    error: "28%",
  },
  upload: {
    title: "One photo, taken straight on.",
    body: "The simulation is only as good as the photo. Three things matter, and none of them need a good camera.",
    guidelines: [
      { n: "1", title: "Face the window", body: "Daylight from the front, nothing bright behind you." },
      { n: "2", title: "Straight on, no tilt", body: "Phone at eye level, arm out, chin level." },
      { n: "3", title: "Nothing on your head", body: "No cap, no hood, hair as it is today." },
    ],
    choose: "Choose a photograph",
    camera: "Use the camera",
    previewCaption: "Your photograph appears here",
    previewAlt: "The photograph you chose",
    oval: "Fill the oval",
  },
  /** With the photo notice's words (consentCopy). */
  consent: {
    continue: "Continue",
    privacy: {
      before: "Read the full ",
      link: "privacy notice",
      after: ".",
    },
  },
  stage: {
    title: "Where are you now?",
    body: "Pick whichever is closest. Your technician measures properly at the visit.",
    continue: "Continue",
  },
  looks: {
    title: "Choose a look.",
    body: "You get one look, so pick the one you'd wear.",
    choose: "Choose one to continue",
    continue: "Continue",
  },
  /** With the gate notice's words (gateCopy). Both fields are needed: the number is where the look goes. */
  gate: {
    frame: "For your WhatsApp only",
    name: "Name",
    namePlaceholder: "Your name",
    nameError: "Tell us what to call you.",
    mobile: "Mobile",
    mobilePlaceholder: "98100 00000",
    mobileError: "Enter a valid 10-digit mobile number.",
    submit: "Send my look",
    // Not drawn: once the WhatsApp code is on its way, the button confirms it and sends the look.
    confirm: "Confirm and send my look",
    sending: "Sending",
    errors: {
      rateLimited: "This number is out of tries for today. Try again tomorrow.",
      taken: "This look is already on its way to another number.",
      other: "That didn't go through. Try again in a minute.",
      // Not drawn: refusals of the WhatsApp code. The owner approves the words.
      codes: "That’s too many codes for this number today. Try again tomorrow.",
      turnstile: "We couldn’t confirm you’re a person. Try again.",
      notProved: "Your WhatsApp code has expired. Press Send my look for a new one.",
    },
  },
  /** After the gate: the look is on its way to WhatsApp, and never shown here. */
  sent: {
    frame: "On its way to your WhatsApp",
    title: "Your new look is on its way.",
    /** The number the visitor gave goes between the two. */
    to: { before: "It'll reach WhatsApp on ", after: " within minutes." },
    // Production's RESULT_RETENTION_DAYS, as the privacy notice gives it.
    privacy: "We delete it after 14 days.",
    disclaimer:
      "An illustrative simulation, not a photograph of a result. Your hair system is matched to your own hair colour, density and growth pattern.",
    book: "Book a free consultation",
    home: "Back to the site",
    /** A visitor who has had their look, back again, whose number the page does not know. */
    returning: {
      title: "Your look has already been sent.",
      body: "We sent it to the WhatsApp number you gave. It's one look per person, every 30 days.",
    },
  },
  error: {
    another: "Choose another",
    book: "Book a visit instead",
    /** By ErrorKind (lib/tryon-errors.ts). v2's labels, heading and body are the photograph's. */
    kinds: {
      photo: {
        step: "Cannot use this photograph",
        frame: "Cannot read the photograph",
        title: "We cannot use this photograph.",
        body: "Your face may be turned, your hairline covered, or the light too low. Face a window and shoot straight on.",
      },
      renderFailed: {
        step: "Something went wrong",
        frame: "The simulation failed",
        title: "The simulation did not work this time.",
        body: "The photograph looked fine; the simulation failed on our side. Try again with the same photograph or another, or book a consultation and see it in person.",
      },
      busy: {
        step: "Please try again shortly",
        frame: "The simulation is busy",
        title: "The simulation is busy just now.",
        body: "Try again in a few minutes, or book a consultation and see it in person.",
      },
      /** While WhatsApp cannot send a look, the try-on does not run (ADR 0104). It has no Choose another. */
      unavailable: {
        step: "Not available right now",
        frame: "Paused",
        title: "The try-on is paused.",
        body: "We send every look on WhatsApp, and that isn't switched on yet. Book a free consultation and see the real thing.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// The WhatsApp code
// ---------------------------------------------------------------------------

/**
 * The code that proves the number before /book's consultation and fit in one visit, or /try's look, acts on it. Not
 * drawn: words for the owner to approve.
 */
export const numberCode = {
  label: "WhatsApp code",
  /** The number the code went to goes after it. */
  sentTo: "Sent on WhatsApp to +91 ",
  hint: "It confirms the number is yours.",
  incomplete: "Enter the six digits from WhatsApp.",
  wrong: (left: number) =>
    left === 1 ? "That code is not right. One try left." : `That code is not right. ${String(left)} tries left.`,
  expired: "That code has expired. Send a new one.",
  failed: "That didn’t go through. Try again.",
  again: "Send a new code",
  checking: "Checking",
};

// ---------------------------------------------------------------------------
// Booking (/book)
// ---------------------------------------------------------------------------

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

/** The business as search engines read it (LocalBusiness). Only published facts. */
export const business = {
  name: "Mane Man",
  description: pageDescriptions.home,
  /** The cities the FAQ says are covered. */
  areaServed: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
  /**
   * A first fit, from the cheapest hair system ops offer to the dearest. Given only while the site gives prices
   * (PRICES_SHOWN, site/src/lib/flags.ts).
   */
  priceRange: "{firstFitRange}",
};

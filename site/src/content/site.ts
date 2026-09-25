// Every string and image on the site, taken word for word from the design
// (design/Mane Man Site v2.dc.html). Components hold no copy of their own.
//
// Two kinds of entry need care before production (docs/frontend.md):
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
//
// Images are file names in design/assets; src/lib/images.ts resolves them.
// `{city}` and similar are filled in by the page.

import { LOSS_EXTENTS, type LossExtent } from "../../../src/config/booking.ts";
import { CURRENT_NOTICE, findNotice, LANDING_NOTICES } from "../../../src/config/notices.ts";
import { PRESETS } from "../../../src/config/presets.ts";
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

// ---------------------------------------------------------------------------
// Placeholder blocks
// ---------------------------------------------------------------------------

/** The business WhatsApp number: the footer's, and every wa.me link. */
export const whatsapp = {
  publish: true,
  number: "919007973247",
  label: "WhatsApp · +91 90079 73247",
};

/** The footer's phone number: the business number, the owner's on 22 September 2026. */
export const phone = {
  publish: true,
  number: "+919007973247",
  label: "Phone · +91 90079 73247",
};

export const heroFootage = {
  publish: false,
  video: "hero.mp4",
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
    {
      file: "step-01-call.jpg",
      alt: "A notebook of scalp measurements and a sketched head, beside a phone and a steel ruler",
    },
    { file: "step-02-template.jpg", alt: "Hands laying strips of tape over cling film on the crown of a head" },
    { file: "step-03-fit.jpg", alt: "Barber’s scissors trimming hair at a bonded hairline" },
    {
      file: "step-04-kit.jpg",
      alt: "A technician’s canvas tool roll laid open, scissors, comb, adhesive remover and brush in order",
    },
  ] satisfies Picture[],
};

export const basePhotos = {
  publish: false,
  standard: {
    file: "base-monofilament.jpg",
    alt: "Macro of a monofilament mesh base with hairs hand-tied into it as visible knots",
  },
  premium: {
    file: "base-thinskin.jpg",
    alt: "Macro of an ultra-thin polyurethane base held between finger and thumb, hair passing through it",
  },
};

export const technicians = {
  publish: false,
  title: "Who comes to your home",
  intro: "The same man fits your first piece and comes back every month after.",
  yearsLabel: "years fitting",
  fitsLabel: "fits completed",
  people: [
    {
      name: "Imran Qureshi",
      photo: { file: "tech-1.jpg", alt: "Imran Qureshi, hair-system technician" },
      years: "11",
      fits: "1,400",
      note: "Does most of our thin-skin work. Covers Gurgaon and South Delhi.",
    },
    {
      name: "Sandeep Rawat",
      photo: { file: "tech-2.jpg", alt: "Sandeep Rawat, hair-system technician" },
      years: "8",
      fits: "900",
      note: "Cuts and colour-matches. Covers Noida, Ghaziabad and East Delhi.",
    },
    {
      name: "Vikas Chauhan",
      photo: { file: "tech-3.jpg", alt: "Vikas Chauhan, hair-system technician" },
      years: "6",
      fits: "600",
      note: "Handles repairs and the monthly visits. Covers Gurgaon and Faridabad.",
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

/** The two long-form pages. Their text is supplied later. */
export const legalPages = {
  privacy: {
    publish: true,
    title: "Privacy",
    paragraphs: [
      "Mane Man Grooming Services Private Limited collects only what it needs to arrange your visit and your simulation. When you book, we keep your name, mobile number, city, preferred visit time and the extent of your hair loss, with how you reached this site. They are held in our own database, hosted by Cloudflare, and in the customer system our team works from, Zoho CRM, and we use them to arrange and confirm the visit and for nothing else; we never sell them. If you use the try-on, your photograph is used only to make your simulation. It is sent to AILabTools, the service that generates it, we never use it to train any model, and it is deleted within thirty days, usually within the hour; the simulation itself is kept for fourteen days. Giving your number at the end of the try-on is optional; if you give it, we use it to send you the result on WhatsApp and for nothing else.",
      "The site sets two cookies of its own, both for the try-on: one keeps your session for thirty minutes, the other remembers for thirty days that you have had your one look, so that this browser can show it to you again while the simulation is kept. We count visits with Cloudflare Web Analytics, and measure our advertising with Google Analytics, Google Ads and Meta, which set their own cookies and never receive your name, number or photograph. Visitors' network addresses are kept only in scrambled form, to limit abuse. Under India's Digital Personal Data Protection Act, 2023, you can ask what we hold about you, have it corrected, or have it erased: message us on WhatsApp at +91 90079 73247 and we erase it the same day.",
    ],
  },
  // Drafted from the site's published prices, guarantee and try-on rules; the owner approved it on 22 September 2026.
  terms: {
    publish: true,
    title: "Terms",
    paragraphs: [
      "These terms cover the service Mane Man Grooming Services Private Limited provides: non-surgical hair systems, measured, fitted and serviced at your home across Delhi NCR. By booking a visit or using the try-on you agree to them. We may change them; the version on this page when you book is the one that applies to that booking.",
      "The first visit is a consultation: an hour, free, and with no obligation to order. Nothing is fitted at it. We confirm the day and time on WhatsApp, and you can move or cancel any visit by messaging us, at no charge. Prices are the ones published on this site when you order. The first fit, which covers the piece, the fitting and the cut, is paid on the day of the fit by card, UPI or bank transfer, and each service visit is paid when it is made. We take no deposit and sell no package.",
      "If the fit is not right, we refit it at no charge, or refund you in full, including the fitting and the cut, within fourteen days of the fit. A hair system is bonded to the skin, so tell the technician about any skin condition, allergy or treatment before the fit; if a system is not suitable for you, we say so and do not fit it. A base wears with use and its life depends on its care, so the replacement intervals we publish are typical, not promised.",
      "The try-on is an illustrative simulation made by software from one photograph. It is not a photograph of a result, and not a promise of how a fitted piece will look: a fitted piece is matched to your own hair colour, density and growth pattern. Upload only a photograph of yourself, and only if you are eighteen or over. Each visitor gets one simulation.",
      "We are responsible for the care and skill of our technicians. Beyond a refit or refund under the guarantee, and except where the law provides otherwise, our liability for a visit is limited to what you paid for it. These terms are governed by the laws of India, and the courts at New Delhi have jurisdiction. For questions or complaints, message or call us on +91 90079 73247.",
    ],
  },
};

// ---------------------------------------------------------------------------
// Global
// ---------------------------------------------------------------------------

export const header = {
  homeLabel: "Mane Man, home",
  nav: [
    { label: "What it is", href: "/#what" },
    { label: "Prices", href: "/#prices" },
    { label: "Questions", href: "/#faq" },
  ],
  area: serviceArea,
  book: "Book a visit",
};

export const stickyBar = {
  whatsappLabel: "Message us on WhatsApp",
  book: "Book a visit",
};

export const footer = {
  columns: {
    service: {
      title: "Service",
      links: [
        { label: "What it is", href: "/#what" },
        { label: "Prices", href: "/#prices" },
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
  title: `Hair, fitted at your home across ${serviceArea}.`,
  body: `A technician comes to your home, matches the piece to the hair you already have, and fits it in about ${visitLength.firstFit}.`,
  tryOn: "See yourself with hair",
  book: "Book a free consultation",
};

export const whatItIs = {
  title: "What it is",
  paragraphs: [
    "A membrane between three and twelve hundredths of a millimetre thick, with human hair knotted or looped through it one strand at a time. It is made to a template of your own scalp, cut to your face, and bonded to the skin.",
    "You sleep in it, shower in it, train in it. Once a month he lifts it off, cleans the base, puts it back and trims the hair.",
  ],
  closing: "It is not a wig. Nothing clips on and it stays on at night.",
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
  title: "Transplant, medication, or a system",
  intro: "Two of these are not ours.",
  columns: ["Transplant", "Medication", "Hair system"],
  yes: "Yes",
  no: "No",
  rows: [
    { label: "Cost", cells: ["₹1.2–3 lakh, once", "₹800–2,000 a month, for life", "₹25,000, then ₹1,500 a month"] },
    { label: "Visible result", cells: ["9–12 months", "4–6 months", "The same day"] },
    { label: "Covers advanced loss", cells: [false, false, true] },
    { label: "Slows the loss itself", cells: [false, true, false] },
    { label: "Surgery", cells: [true, false, false] },
    { label: "Reversible", cells: [false, true, true] },
    { label: "Upkeep", cells: ["None, once healed", "Daily, for life", "One visit a month"] },
  ] satisfies { label: string; cells: [ComparisonCell, ComparisonCell, ComparisonCell] }[],
  note: "A transplant moves hair you still have. Medication protects what is left. A system covers what has gone. Plenty of men do two of the three.",
};

export const tryOnTeaser = {
  eyebrow: "Try-on",
  title: "See yourself with hair before anyone comes to your home.",
  body: "One photograph, one look from six. What you get back is a simulation, not a photograph of a result. Your photograph is deleted after thirty days.",
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
      title: "A call",
      body: "We ask what stage you are at and tell you what a system can and cannot do.",
      meta: "Fifteen minutes · free",
    },
    {
      number: "02",
      title: "Consultation at home",
      body: "A template of your scalp taken in cling film and tape, and your hair colour matched against forty samples in daylight.",
      meta: `${capitalised(visitLength.consultation)} · free`,
    },
    {
      number: "03",
      title: "The fit",
      body: "Your piece arrives cut to that template. The technician seats it, trims it into your own hair and styles it.",
      meta: `${capitalised(visitLength.firstFit)} · at your table`,
    },
    {
      number: "04",
      title: "Monthly service",
      body: "He returns each month to lift the base, clean it, re-seat it and trim the hair back to your own growth.",
      meta: `₹1,500 a visit · ${visitLength.service}`,
    },
  ],
};

/** A base's cross-section drawing, in the design's 320 × 176 box. */
export interface BaseDrawing {
  readonly membrane: string;
  readonly detail: string;
  readonly dash: string;
  readonly knots: string;
  readonly hair: string;
  readonly tag: string;
  readonly tag2: string;
}

export const bases = {
  title: "Two bases, two prices",
  scalp: "Scalp",
  rowLabels: { look: "Look", breath: "Breathability", life: "Lifespan", price: "First fit" },
  kinds: [
    {
      id: "standard" as const,
      name: "Standard",
      spec: "Monofilament / lace mesh 0.06–0.12 mm",
      look: "Soft, forgiving at the parting",
      breath: "High — the mesh is open",
      life: "Six to eight months",
      price: "₹25,000",
      drawing: {
        tag: "Hand-tied knots",
        tag2: "Mesh base",
        membrane: "M14 86 H306",
        dash: "3 5",
        detail:
          "M14 93 H306 M44 86 V93 M74 86 V93 M104 86 V93 M134 86 V93 M164 86 V93 M194 86 V93 M224 86 V93 M254 86 V93 M284 86 V93",
        knots:
          "M60 89 C58 80 66 76 70 82 C72 86 64 90 62 86 M140 89 C138 80 146 76 150 82 C152 86 144 90 142 86 M220 89 C218 80 226 76 230 82 C232 86 224 90 222 86",
        hair: "M62 82 C58 62 70 42 96 30 M142 82 C138 60 152 40 178 28 M222 82 C218 60 232 40 258 30 M96 84 C92 64 104 46 128 36 M178 84 C174 64 186 46 210 36",
      } satisfies BaseDrawing,
    },
    {
      id: "premium" as const,
      name: "Premium",
      spec: "Polyurethane thin skin 0.03–0.10 mm",
      look: "Hair appears to leave the scalp",
      breath: "Lower — the membrane is sealed",
      life: "Four to six months",
      price: "₹40,000",
      drawing: {
        tag: "V-looped, no knots",
        tag2: "Thin skin",
        membrane: "M14 88 H306 M14 91.5 H306",
        dash: "0",
        detail: "M40 94 C60 102 90 102 110 94 M120 94 C140 102 170 102 190 94 M200 94 C220 102 250 102 270 94",
        knots: "M64 88 C60 92 60 94 64 91.5 M144 88 C140 92 140 94 144 91.5 M224 88 C220 92 220 94 224 91.5",
        hair: "M64 88 C60 64 72 42 98 28 M144 88 C140 62 154 40 180 26 M224 88 C220 62 234 40 260 28 M98 88 C94 64 106 46 130 34 M180 88 C176 64 188 46 212 34",
      } satisfies BaseDrawing,
    },
  ],
};

export const prices = {
  label: "Published prices",
  intro: "No consultation fee, no deposit, no package. You pay for the piece and for the visits you take.",
  columns: ["Standard", "Premium"],
  rows: [
    { label: "First fit", note: "The piece, the fitting and the cut", standard: "₹25,000", premium: "₹40,000" },
    {
      label: "Monthly service visit",
      note: "Refit, clean, trim — at your home",
      standard: "₹1,500",
      premium: "₹2,000",
    },
    { label: "Replacement piece", note: "Every six months", standard: "₹17,000", premium: "₹30,000" },
  ],
  example: "A standard base in the first year: ₹25,000 plus twelve service visits at ₹1,500 — ₹43,000.",
  payment: "Payment on the day of the fit. Card, UPI or bank transfer.",
  book: "Book a free consultation",
  tryOn: "Or see yourself with hair first",
};

export const guarantee = {
  label: "The guarantee",
  text: "If the fit is not right we will refit it at no charge, or refund you in full, within fourteen days.",
};

export const faq = {
  title: "Questions",
  intro: { before: "If yours is not here, ", link: "ask on WhatsApp", after: "." },
  items: [
    {
      q: "Will anyone be able to tell?",
      a: "At conversational distance, no — the front hairline is where it is won or lost, and a thin-skin base puts each hair through a membrane three hundredths of a millimetre thick. Under a shower, or a hand run backwards through the hair, someone would know.",
    },
    {
      q: "How long does a piece last?",
      a: "A monofilament base runs six to eight months with monthly servicing. Thin skin is finer and shorter-lived: four to six months. The base wears out before the hair does.",
    },
    {
      q: "What happens during the monthly service visit?",
      a: `The technician lifts the piece, cleans the adhesive off the base and your scalp, checks the knots, re-seats it and trims the hair to match your own growth. About ${visitLength.service}, at your home.`,
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
      a: "Colour is matched against forty samples in daylight at the consultation, including the grey percentage. The hairline is drawn on your forehead with a pencil and agreed before the piece is ordered.",
    },
    {
      q: "What if I do not like it at the fit?",
      a: "Fourteen days to change your mind: we refit it at no charge or refund you in full, including the fitting and the cut.",
    },
    {
      q: "Which cities do you cover?",
      a: "All of Delhi NCR: Gurgaon, Delhi, Noida, Faridabad and Ghaziabad. Mumbai and Bengaluru are next. Leave your number and we will tell you when a technician is working in your city.",
    },
    {
      q: "What does the first year cost in total?",
      a: "A standard base: ₹25,000 for the first fit plus twelve monthly service visits at ₹1,500, so ₹43,000. Premium: ₹40,000 plus twelve at ₹2,000, so ₹64,000. A replacement piece at six months is separate.",
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

/** The six looks: the backend's presets, in its order. The design splits each label at its first " · ". */
export const looks = PRESETS.map((preset) => {
  const [density = preset.label, ...rest] = preset.label.split(" · ");
  return { id: preset.id, label: preset.label, density, detail: rest.join(" · ") };
});

function photoNoticeParts(lines: readonly string[]) {
  const [title = "", ...rest] = lines;
  const agreement = rest.at(-1) ?? "";
  const rows = rest.slice(0, -1).map((line) => {
    const [k = "", ...v] = line.split(": ");
    return { k, v: v.join(": ") };
  });
  return { title, rows, agreement };
}

const [gateCaption = "", gateTitle = "", gateBody = "", gateReassurance = ""] = notices.gate.lines;

export const tryOn = {
  back: "Back",
  backToSite: "Back to the site",
  stepLabels: {
    upload: "Step one of five",
    consent: "Before we begin",
    stage: "Step two of five",
    looks: "Step three of five",
    processing: "Step four of five",
    gate: "Step five of five",
    result: "Your result",
    error: "Cannot use this photograph",
  },
  progress: {
    upload: "14%",
    consent: "28%",
    stage: "44%",
    looks: "60%",
    processing: "78%",
    gate: "90%",
    result: "100%",
    error: "28%",
  },
  upload: {
    title: "One photograph, taken straight on.",
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
  consent: {
    ...photoNoticeParts(notices.photo.lines),
    continue: "Continue",
    privacy: {
      before: "The full ",
      link: "privacy notice",
      after: " is two paragraphs long, and it is linked in the footer.",
    },
  },
  stage: {
    title: "Where are you now?",
    body: "Pick whichever is closest. He measures properly at the visit.",
    continue: "Continue",
  },
  looks: {
    title: "Choose a look.",
    body: "Six to choose from, and one simulation each, so choose the one you would wear.",
    preview: "Preview",
    choose: "Choose one to continue",
    generate: "Generate the simulation",
    // Not in v2: back here once the render has started, when the look can no longer change. Placeholder words.
    fixed: "Your simulation is being made with this look. Each visitor gets one.",
    continue: "Continue",
  },
  processing: {
    title: "Working on it.",
    seconds: 20,
    steps: [
      { label: "Reading the photograph", at: 2 },
      { label: "Finding the hairline", at: 6 },
      { label: "Placing the hair", at: 11 },
      { label: "Matching the light", at: 16 },
    ],
  },
  gate: {
    caption: gateCaption,
    ready: "Your result · ready",
    title: gateTitle,
    body: gateBody,
    name: "Name",
    namePlaceholder: "Your name",
    nameError: "Tell us what to call you.",
    mobile: "Mobile",
    mobilePlaceholder: "98100 00000",
    mobileError: "Enter all ten digits so we can send the result.",
    submit: "Show me the result",
    sending: "Saving",
    reassurance: gateReassurance,
    errors: {
      rateLimited: "This number has had several results today. Please try again tomorrow.",
      taken: "This result is already saved to another number.",
      other: "That did not go through. Please try again in a minute.",
    },
  },
  result: {
    title: "Drag the handle to compare.",
    before: "Before",
    after: "After",
    beforeAlt: "Your photograph",
    afterAlt: "Simulated result",
    sliderLabel: "Compare your photograph with the simulation",
    sliderValue: "{before}% your photograph, {after}% the simulation",
    pending: "Still working on it",
    disclaimer:
      "This is an illustrative simulation, not a photograph of a result. A fitted piece is matched to your own hair colour, density and growth pattern, and will differ.",
    book: "Book a free consultation",
    download: "Download",
    whatsapp: "WhatsApp",
    // The simulation's retention in production, RESULT_RETENTION_DAYS, as the privacy notice gives it (ADR 0039).
    copy: { before: "A copy is on its way to ", after: ". Deleted after fourteen days." },
    fileName: "mane-man-simulation",
    /** A visitor who has had their look, back again: the result alone, since the photograph is not kept. */
    returning: {
      title: "The look you had.",
      note: "Each visitor gets one simulation, and this is yours.",
    },
    share: "My Mane Man simulation. See yours at maneman.in/try",
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
        body: "Either the face is turned too far, something is covering the hairline, or the frame is too dark to read. A photograph taken facing a window, straight on, works almost every time.",
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
        body: "Too many people are trying it at once, or it could not be reached. Please try again in a little while, or book a consultation and see it in person.",
      },
      /** Only when this browser's look can no longer be shown: otherwise the page shows it again. */
      lookLimit: {
        step: "One look per visitor",
        frame: "Your look is no longer kept",
        title: "You have had your look.",
        body: "Each visitor gets one simulation, and this browser has had its one, which is no longer kept. The consultation shows you the real thing, in person, and costs nothing.",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Booking (/book)
// ---------------------------------------------------------------------------

/**
 * The site's own booking page, the referral landing without its invite (docs/decisions/0051-booking-from-the-site.md).
 * The form's words are the landing's (referral.ts); these are the page's own.
 */
export const booking = {
  title: "Book a free consultation",
  intro: `Nothing is fitted on the first visit. He measures your scalp and matches your colour, then leaves. ${capitalised(visitLength.consultation)}, nothing to pay.`,
  extent: "Extent of hair loss",
};

// ---------------------------------------------------------------------------
// Other pages
// ---------------------------------------------------------------------------

export const notFound = {
  title: "This page is not here.",
  body: "The address may have changed. Everything is on the home page.",
  home: "Back to the site",
};

export const pageTitles = {
  home: `Mane Man — hair, fitted at your home across ${serviceArea}`,
  tryOn: "See yourself with hair — Mane Man",
  book: "Book a free consultation — Mane Man",
  privacy: "Privacy — Mane Man",
  terms: "Terms — Mane Man",
  notFound: "Not found — Mane Man",
};

/** Each page's description, for search results and shared links. */
export const pageDescriptions = {
  home: hero.body,
  tryOn: tryOnTeaser.body,
  book: booking.intro,
  privacy: "What Mane Man keeps about you, who processes it, how long it is kept, and how to have it erased.",
  terms: "The terms of Mane Man's hair system service.",
};

/** The business as search engines read it (LocalBusiness). Only published facts. */
export const business = {
  name: "Mane Man",
  description: hero.body,
  /** The cities the FAQ says are covered. */
  areaServed: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
  priceRange: "₹25,000–₹40,000",
};

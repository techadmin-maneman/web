// The home page, its header, sticky bar and footer, section by section.

import { GUARANTEE } from "@maneman/web-kit/guarantee";
import { capitalised, serviceArea, visitLength } from "../service.ts";
import { basePhotos, type Picture } from "./media.ts";

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
  book: "Book a consultation",
};

export const stickyBar = {
  /** What a screen reader calls the bar's landmark. */
  label: "Book or message us",
  whatsappLabel: "Message us on WhatsApp",
  book: "Book a consultation",
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
  title: "A full head of hair, matched to your own.",
  body: "Your technician comes when it suits you, matches a hair system to your own hair and fits it.",
  tryOn: "Try a new look",
  book: "Book a free consultation",
  // Not in v2: the footage loops, so it can be stopped (WCAG 2.2.2).
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
  // The look on WhatsApp only is ADR 0104's.
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

/** The four hair systems, from the product guide. */
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

interface MaterialItem {
  readonly name: string;
  readonly text: string;
  /** One word for each of its group's `rated` labels, in their order. */
  readonly ratings?: readonly string[];
}

interface MaterialGroup {
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

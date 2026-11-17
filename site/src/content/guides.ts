// The guides: the questions people ask a search engine before they ask us, answered in the site's own facts, and the
// cities we come to. Each is a draft until its wording is approved: unpublished, it is built for staging with the
// design's "Placeholder" tag, and production builds no page for it at all (src/pages/guides/, src/routes/).
//
// No price is written here: a guide says what a price depends on, and that it is quoted at the free consultation
// (docs/decisions/0073-prices-from-the-price-book.md). The publish gate reads these pages for typed prices too.

import { visitLength } from "./service.ts";

export interface GuideSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface Guide {
  /** Its address under /guides/. */
  readonly slug: string;
  /** Its wording is approved; until then production builds no page for it. */
  readonly publish: boolean;
  readonly title: string;
  /** The line a search engine shows beneath the title. */
  readonly description: string;
  /** The sentence beneath the title on the page. */
  readonly lead: string;
  readonly sections: readonly GuideSection[];
  /** A photograph beneath the lead, from our own fits and hair systems; a guide of words alone has none. */
  readonly picture?: { readonly file: string; readonly alt: string };
  /** When it was first published and last changed, as search engines are told: change `updated` with the words. */
  readonly published: string;
  readonly updated: string;
}

export const guidesPage = {
  title: "Guides",
  pageTitle: "Hair system guides — Mane Man",
  description:
    "Straight answers on hair systems: how they compare with a transplant, and how they’re fitted, cared for and priced.",
  lead: "Straight answers, before you book anything.",
  book: "Book a free consultation",
  /** Beneath each guide: the others, and the try-on and the home page's questions. */
  related: "More guides",
  tryOn: "Try a new look",
  questions: "Common questions",
  /** The way back a search result shows: Home › Guides › the guide. */
  home: "Home",
  /** Above a long guide's sections: a link to each. */
  contents: "On this page",
};

export const guides: readonly Guide[] = [
  {
    slug: "hair-system-or-transplant",
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "Hair system or hair transplant",
    description: "Hair system or transplant: what each involves, how soon you see a result, and who each suits.",
    lead: "Two ways back to a full head of hair. Here’s how they differ.",
    sections: [
      {
        heading: "What each one is",
        paragraphs: [
          "A transplant moves hair you still have, usually from the back of your head, to where it has thinned. It is surgery, and the moved hair grows in over the months that follow.",
          "A hair system is 100% real human hair on a fine base, shaped to your scalp and bonded over the area you’ve lost. Nothing is cut or moved, and you leave the visit with the look you chose.",
        ],
      },
      {
        heading: "When you see it",
        paragraphs: [
          "A transplant takes months to show, and how full it ends up depends on how much hair you have to move.",
          "A hair system shows the day it’s fitted. Its density is matched to the hair at your sides, so it reads as yours, not as new.",
        ],
      },
      {
        heading: "What it asks of you",
        paragraphs: [
          "A transplant asks for recovery time, and patience while the hair grows.",
          "A hair system asks for a visit about once a month: your technician lifts it, cleans the base, bonds it again and keeps the cut sharp. The base wears in months, not years, and is renewed when it does.",
        ],
      },
      {
        heading: "Which suits you",
        paragraphs: [
          "If there’s little hair left to move, or you’d rather avoid surgery, a hair system is the straighter road. If you have the hair to move and want something you never think about again, a transplant may suit you better: ask a surgeon.",
          "At the free consultation, your technician looks at your hair, tells you honestly what a hair system will and won’t do, and quotes before anything is fitted.",
        ],
      },
    ],
  },
  {
    slug: "what-is-a-hair-system",
    picture: {
      file: "guide-what-is-a-hair-system.jpg",
      alt: "A hair system turned over: its fine base, lace at the front, the hair around it",
    },
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "What a hair system is",
    description:
      "100% real human hair on a fine base, bonded to the skin. What a hair system is made of, and why it isn’t a wig.",
    lead: "100% real human hair, a fine base, and a hairline that passes a close look.",
    sections: [
      {
        heading: "The hair and the base",
        paragraphs: [
          "Every strand is 100% real human hair, tied into the base by hand. The base is fine lace, monofilament mesh or a clear skin film, and it decides almost everything: how natural it looks, how cool it feels and how long it lasts.",
          "The thinner the base, the better it looks and the sooner it wears. Your technician helps you choose at the consultation.",
        ],
      },
      {
        heading: "The hairline",
        paragraphs: [
          "The hairline is where a hair system is won or lost. Every hairline we fit is lace, its knots bleached until they vanish, so it melts into the skin at your forehead.",
        ],
      },
      {
        heading: "Why it isn’t a wig",
        paragraphs: [
          "A wig covers the whole head, is held by tension or clips and comes off at night. A hair system covers only the area you’ve lost, is bonded to the skin, is cut into your own hair and stays on for weeks at a time. You shower, swim and sleep in it.",
        ],
      },
    ],
  },
  {
    slug: "hair-system-materials",
    picture: { file: "guide-materials.jpg", alt: "A mono base with a lace border, seen from the inside" },
    publish: true,
    published: "2026-10-19",
    updated: "2026-10-19",
    title: "Materials and construction",
    description: "Lace, mono, skin and silk; knots, loops and density. What each hair system is made of, and why.",
    lead: "What each hair system is made of, and what that means for how it looks, breathes and lasts.",
    sections: [
      {
        heading: "The base: lace, mono, skin and silk",
        paragraphs: [
          "The base decides everything: how natural it looks, how cool it feels, how long it lasts. The thinner the base, the better it looks and the sooner it wears.",
          "Lace: the finest, softest mesh. Its knots can be bleached until they vanish, which is why every hairline we fit is lace.",
          "Mono: monofilament, a fine, tough mesh. It breathes, takes the most hair, and outlasts every other base.",
          "Skin: a clear polyurethane film, 0.08 to 0.10 mm thin. No mesh to see, so the hair seems to grow straight from the scalp.",
          "Silk, multi-layer: hair knotted onto a lace layer and drawn up through silk, so every knot sits hidden between the two. A parting shows scalp.",
        ],
      },
      {
        heading: "How the hair is tied in: knots and loops",
        paragraphs: [
          "Every hair is tied or looped into the base by hand. How it is tied decides how natural the root looks and how well it holds.",
          "Single knot: one small knot for each hair. Fine and flat, on lace and skin.",
          "Double knot: each hair knotted twice, for the sides and back of a mono base.",
          "Bleached knot: knots lightened until they disappear. Only lace takes it, so it is kept for the hairline.",
          "V-looped: no knot at all. Each hair is looped through the skin, so it seems to grow from it.",
          "Injected: hair set into the skin so that it stands up from the root. Made for a parting or a brushed-back style.",
        ],
      },
      {
        heading: "The rim and the hairline",
        paragraphs: [
          "The edges are where a hair system is held, and where it is seen.",
          "Clear PU rim: a thin, transparent polyurethane edge. The tape grips it, never the mesh, and it disappears at the temples.",
          "NPU rim: polyurethane reinforced with mesh. Stronger and slightly thicker, so it is kept to the sides and back, where nobody looks.",
          "Lace front: up to an inch of lace along the hairline, its knots bleached until they disappear. It is what lets a hairline pass a close look, and every hair system we fit has one.",
        ],
      },
      {
        heading: "How much hair: density",
        paragraphs: [
          "Density is how much hair is tied in, against a full natural head. More is not better: too much hair is what gives a hair system away. We match yours to the hair you still have at the sides, not the hair you had at twenty.",
          "80%, light: the scalp shows at a parting. For men over sixty.",
          "100%, medium light: natural, without much volume. Most men’s choice, and ours over forty.",
          "120%, medium: visibly fuller, and holds a style. For younger men, and men whose own hair is thick.",
          "140%, medium heavy: heavy for daily wear. On request only.",
        ],
      },
      {
        heading: "The hair",
        paragraphs: [
          "100% real human hair: cut, washed and styled like your own. It does not grow, so the hair system is renewed when it wears.",
          "Indian remy hair, on Mane Man Celebrity: every hair runs the same way, root to tip, so it tangles less and holds its shine longer.",
          "Matched to you: colour, grey and wave matched to your own hair in daylight, at the consultation.",
        ],
      },
      {
        heading: "What we do not fit, and why",
        paragraphs: [
          "Ultra-thin skin, 0.03 mm: the most invisible base made, and it lasts about a month.",
          "Full Swiss lace: the most fragile base there is, lasting one to two months.",
          "Lace with no rim: it must be glued along its whole edge every few weeks. A salon job, not a home service.",
          "140% and denser, as standard: too much hair is what makes a hair system obvious.",
          "European hair: finer, dearer, and a poor match for Indian hair.",
        ],
      },
    ],
  },
  {
    slug: "how-a-hair-system-is-fitted",
    picture: {
      file: "guide-fitted.jpg",
      alt: "A fitted hair system from the side, blended into the client’s own hair",
    },
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "How a hair system is fitted at home",
    description:
      "What happens when a technician fits a hair system at your home: the consultation, the colour match, the fit and the cut.",
    lead: "Your technician comes to you. No one sees you walk in anywhere.",
    sections: [
      {
        heading: "The free consultation",
        paragraphs: [
          "Your technician measures your scalp, matches your colour to samples in daylight, grey included, and draws the hairline on your forehead in pencil for you to agree. You choose the base together, and you hear the price before anything is fitted.",
        ],
      },
      {
        heading: "The fit",
        paragraphs: [
          "At the same visit or a later one, as you prefer, the hair under the base is trimmed short, not shaved. The hair system is bonded to the skin, then cut into your own hair and styled. You see the result in the mirror before your technician leaves.",
        ],
      },
      {
        heading: "Where it happens",
        paragraphs: [
          "At home, at a time that suits you. All you need is a chair in good light and somewhere to wash hair.",
        ],
      },
    ],
  },
  {
    slug: "looking-after-a-hair-system",
    picture: { file: "guide-care.jpg", alt: "A hair system brushed gently with a wide paddle brush" },
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "Looking after a hair system",
    description: "Daily care for a hair system, what to do after a swim, and what happens at a service visit.",
    lead: "A few habits at home, and a visit about once a month.",
    sections: [
      {
        heading: "Every day",
        paragraphs: [
          "Wash and style it like your own hair, gently. It doesn’t grow, so the cut stays as it was left.",
          "Heavy sweating is fine. After a swim in chlorine or the sea, rinse it in fresh water: both shorten the life of the base.",
        ],
      },
      {
        heading: "The service visit",
        paragraphs: [
          `About once a month, your technician comes back to lift the hair system, clean the base and your scalp, bond it again and refresh the cut. It takes ${visitLength.service}, and keeps it looking like the day it was fitted.`,
        ],
      },
      {
        heading: "When it’s time for a new one",
        paragraphs: [
          "The base wears before the hair does. When it does, your technician tells you, and your new hair system is matched to the last, so no one notices the change.",
        ],
      },
    ],
  },
  {
    slug: "how-long-a-hair-system-lasts",
    picture: { file: "guide-lasts.jpg", alt: "A thin skin base, the film that wears first" },
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "How long a hair system lasts",
    description:
      "A hair system lasts months, not years. What decides how long yours lasts, and how to make it last longer.",
    lead: "Months, not years: the base wears before the hair does.",
    sections: [
      {
        heading: "What decides it",
        paragraphs: [
          "The base. A clear skin film looks the most natural and wears the soonest; monofilament mesh outlasts every other base. Heat, sea water and chlorine all shorten its life, and so does skipping service visits.",
        ],
      },
      {
        heading: "How to make it last",
        paragraphs: [
          "Rinse it in fresh water after a swim, keep your service visits, and choose a base that suits how you live: a lace top for the gym and a Delhi summer, a skin base where nothing must show.",
        ],
      },
      {
        heading: "What we tell you",
        paragraphs: [
          "At the consultation, before anything is fitted, your technician tells you what to expect from the base you choose.",
        ],
      },
    ],
  },
  {
    slug: "what-a-hair-system-costs",
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "What decides the cost of a hair system",
    description:
      "What decides the price of a hair system, what you pay for and when, and why you hear the price before anything is fitted.",
    lead: "You hear the price at a free consultation, before anything is fitted or paid.",
    sections: [
      {
        heading: "What you pay for",
        paragraphs: [
          "The hair system itself, and the visits: the first fit, then a service visit about once a month. No consultation fee, no deposit, no package.",
        ],
      },
      {
        heading: "What decides the price",
        paragraphs: [
          "The base most of all: lace, monofilament and skin are made differently and last differently. The size of the area to cover, and the density matched to your own hair, matter too.",
        ],
      },
      {
        heading: "When you hear it",
        paragraphs: [
          "At the free consultation, from your technician, before anything is fitted. If it isn’t for you, you owe nothing.",
        ],
      },
    ],
  },
];

/** The cities we come to, as the home page's questions name them; the served pincodes decide the streets. */
export const areasPage = {
  publish: true,
  pageTitle: "Areas we cover — Mane Man",
  description: "Hair systems fitted at home by a trained technician, in the cities we serve.",
  title: "Areas we cover",
  // As built, naming no city; the site's Worker writes in the cities ops serve (site/src/lib/cities.ts).
  lead: "Your technician comes to your home, wherever we serve.",
  cities: "Your technician comes to your home in {cities}.",
  /** The pincodes we serve decide the streets, so a visitor checks theirs. */
  streets: "Within each city, we serve by pincode. Check yours to see the days we can come.",
  next: "Not there yet? Leave your number on the booking page, and we’ll tell you when we reach your city.",
  check: "Check your pincode",
  /** Its list of the cities, each a page of its own. */
  cityPages: "City by city",
};

/**
 * A page for each city the FAQ names (business.areaServed in ./site/contact.ts), where a search for a hair system in
 * that city lands. The areas we come to there are listed from the served pincodes, which the site's Worker writes in.
 */
export const cityPage = {
  publish: true,
  pageTitle: "Hair systems in {city} — Mane Man",
  title: "Hair systems in {city}",
  description: "Hair systems in 100% real human hair, fitted at your home in {city}. The consultation is free.",
  lead: "Your technician comes to your home in {city}, matches a hair system to your own hair and fits it there.",
  areas: "Areas we cover in {city}",
  streets: "Within the city, we serve by pincode. Check yours to see the days we can come.",
  check: "Check your pincode",
  others: "Other cities",
};

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
  /** When it was first published and last changed, as search engines are told: change `updated` with the words. */
  readonly published: string;
  readonly updated: string;
}

export const guidesPage = {
  title: "Guides",
  pageTitle: "Hair system guides — Mane Man",
  description:
    "Straight answers on hair systems: how they compare with a transplant, and how they're fitted, cared for and priced.",
  lead: "Straight answers, before you book anything.",
  book: "Book a free consultation",
  /** Beneath each guide: the others, and the try-on and the home page's questions. */
  related: "More guides",
  tryOn: "Try a new look",
  questions: "Common questions",
  /** The way back a search result shows: Home › Guides › the guide. */
  home: "Home",
};

export const guides: readonly Guide[] = [
  {
    slug: "hair-system-or-transplant",
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "Hair system or hair transplant",
    description: "Hair system or transplant: what each involves, how soon you see a result, and who each suits.",
    lead: "Two answers to the same mirror. Here's how they differ.",
    sections: [
      {
        heading: "What each one is",
        paragraphs: [
          "A transplant moves hair you still have, usually from the back of your head, to where it has thinned. It is surgery, and the moved hair grows in over the months that follow.",
          "A hair system is 100% real human hair on a fine base, shaped to your scalp and bonded over the area you've lost. Nothing is cut or moved, and you leave the visit with the look you chose.",
        ],
      },
      {
        heading: "When you see it",
        paragraphs: [
          "A transplant takes months to show, and how full it ends up depends on how much hair you have to move.",
          "A hair system shows the day it's fitted. Its density is matched to the hair at your sides, so it reads as yours, not as new.",
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
          "If there's little hair left to move, or you'd rather avoid surgery, a hair system is the straighter road. If you have the hair to move and want something you never think about again, a transplant may suit you better: ask a surgeon.",
          "At the free consultation, your technician looks at your hair, tells you honestly what a hair system will and won't do, and quotes before anything is fitted.",
        ],
      },
    ],
  },
  {
    slug: "what-is-a-hair-system",
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "What a hair system is",
    description:
      "100% real human hair on a fine base, bonded to the skin. What a hair system is made of, and why it isn't a wig.",
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
        heading: "Why it isn't a wig",
        paragraphs: [
          "A wig covers the whole head, is held by tension or clips and comes off at night. A hair system covers only the area you've lost, is bonded to the skin, is cut into your own hair and stays on for weeks at a time. You shower, swim and sleep in it.",
        ],
      },
    ],
  },
  {
    slug: "how-a-hair-system-is-fitted",
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
    publish: true,
    published: "2026-10-11",
    updated: "2026-10-13",
    title: "Looking after a hair system",
    description: "Daily care for a hair system, what to do after a swim, and what happens at the monthly visit.",
    lead: "A few habits at home, and a visit about once a month.",
    sections: [
      {
        heading: "Every day",
        paragraphs: [
          "Wash and style it like your own hair, gently. It doesn't grow, so the cut stays as it was left.",
          "Heavy sweating is fine. After a swim in chlorine or the sea, rinse it in fresh water: both shorten the life of the base.",
        ],
      },
      {
        heading: "The monthly visit",
        paragraphs: [
          `About once a month, your technician comes back to lift the hair system, clean the base and your scalp, bond it again and refresh the cut. It takes ${visitLength.service}, and keeps it looking like the day it was fitted.`,
        ],
      },
      {
        heading: "When it's time for a new one",
        paragraphs: [
          "The base wears before the hair does. When it does, your technician tells you, and your new hair system is matched to the last, so no one notices the change.",
        ],
      },
    ],
  },
  {
    slug: "how-long-a-hair-system-lasts",
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
          "The base. A clear skin film looks the most natural and wears the soonest; monofilament mesh outlasts every other base. Heat, sea water and chlorine all shorten its life, and so does skipping the monthly visit.",
        ],
      },
      {
        heading: "How to make it last",
        paragraphs: [
          "Rinse it in fresh water after a swim, keep the monthly visit, and choose a base that suits how you live: a lace top for the gym and a Delhi summer, a skin base where nothing must show.",
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
          "The hair system itself, and the visits: the fit, then a visit about once a month. No consultation fee, no deposit, no package.",
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
          "At the free consultation, from your technician, before anything is fitted. If it isn't for you, you owe nothing.",
        ],
      },
    ],
  },
];

/** The cities we come to, as the home page's questions name them; the served pincodes decide the streets. */
export const areasPage = {
  publish: true,
  pageTitle: "Where we come — Mane Man",
  description: "Hair systems fitted at home by a trained technician, in the cities we serve.",
  title: "Where we come",
  // As built, naming no city; the site's Worker writes in the cities ops serve (site/src/lib/cities.ts).
  lead: "Your technician comes to your home, wherever we serve.",
  cities: "Your technician comes to your home in {cities}.",
  /** The pincodes we serve decide the streets, so a visitor checks theirs. */
  streets: "Within each city, we serve by pincode. Check yours to see the days we can come.",
  next: "Not there yet? Leave your number on the booking page, and we'll tell you when we reach your city.",
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
  areas: "Where we come in {city}",
  streets: "Within the city, we serve by pincode. Check yours to see the days we can come.",
  check: "Check your pincode",
  others: "Other cities",
};

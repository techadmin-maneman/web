// The guides: the questions people ask a search engine before they ask us, answered in the site's own facts, and the
// cities we come to. Each is a draft until the owner approves its wording: unpublished, it is built for staging with the
// design's "Placeholder" tag, and production builds no page for it at all (src/pages/guides/, src/pages/areas/).
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
  /** The owner has approved its wording; until then production builds no page for it. */
  readonly publish: boolean;
  readonly title: string;
  /** The line a search engine shows beneath the title. */
  readonly description: string;
  /** The sentence beneath the title on the page. */
  readonly lead: string;
  readonly sections: readonly GuideSection[];
}

export const guidesPage = {
  title: "Guides",
  pageTitle: "Hair system guides · Mane Man",
  description:
    "Straight answers on hair systems: how they compare with a transplant, how they are fitted, cared for and priced.",
  lead: "Straight answers, before you book anything.",
  read: "Read",
  book: "Book a free consultation",
};

export const guides: readonly Guide[] = [
  {
    slug: "hair-system-or-transplant",
    publish: false,
    title: "Hair system or hair transplant",
    description:
      "How a hair system and a hair transplant differ: what each asks of you, how soon you see it, and who each suits.",
    lead: "Two different answers to the same mirror. Here is how they differ.",
    sections: [
      {
        heading: "What each one is",
        paragraphs: [
          "A transplant moves hair you still have, usually from the back of the head, to where it has thinned. It is surgery, and the hair it moves grows in over the months that follow.",
          "A hair system is real human hair tied into a fine base, shaped to your scalp and bonded to the skin over the area you have lost. Nothing is cut or moved. You leave the visit with the look you chose.",
        ],
      },
      {
        heading: "When you see it",
        paragraphs: [
          "A transplant takes months to show, and how full it ends up depends on how much hair there is to move.",
          "A hair system shows the day it is fitted. The density is matched to the hair you still have at the sides, so it reads as yours rather than as new.",
        ],
      },
      {
        heading: "What it asks of you after",
        paragraphs: [
          "A transplant asks for recovery time and patience while the hair grows.",
          "A hair system asks for a visit about once a month, when your technician lifts it, cleans the base, re-bonds it and keeps the cut sharp. The base wears in months, not years, and is renewed when it does.",
        ],
      },
      {
        heading: "Which suits you",
        paragraphs: [
          "If there is little hair left to move, or you would rather not have surgery, a hair system is the straighter road. If you want something you never think about again and have the hair to move, a transplant may suit you better, and a surgeon is the person to ask.",
          "At the free consultation your technician looks at your hair, tells you honestly what a hair system will and will not do, and quotes before anything is fitted.",
        ],
      },
    ],
  },
  {
    slug: "what-is-a-hair-system",
    publish: false,
    title: "What a hair system is",
    description:
      "A hair system is real human hair tied into a fine base and bonded to the skin. What it is made of, and why it is not a wig.",
    lead: "Real hair, a fine base, and a hairline that passes a close look.",
    sections: [
      {
        heading: "The hair and the base",
        paragraphs: [
          "Every hair is real human hair, tied into the base by hand, strand by strand. The base is a fine lace, a monofilament mesh or a clear skin film, and it decides almost everything: how natural it looks, how cool it feels and how long it lasts.",
          "The thinner the base, the better it looks and the sooner it wears. Your technician helps you choose between them at the consultation.",
        ],
      },
      {
        heading: "The hairline",
        paragraphs: [
          "The hairline is where a hair system is won or lost. Every one we fit has a lace front, its knots bleached until they vanish, so it melts into the skin at the forehead.",
        ],
      },
      {
        heading: "Why it is not a wig",
        paragraphs: [
          "A wig covers the whole head, is held by tension or clips and comes off at night. A hair system covers only the area you have lost, is bonded to the skin, is cut into your own hair and stays on for weeks at a time. You shower, swim and sleep in it.",
        ],
      },
    ],
  },
  {
    slug: "how-a-hair-system-is-fitted",
    publish: false,
    title: "How a hair system is fitted at home",
    description:
      "What happens when a technician fits a hair system at your home: the consultation, the colour match, the fit and the cut.",
    lead: "Your technician comes to you. Nobody sees you walk in anywhere.",
    sections: [
      {
        heading: "The free consultation",
        paragraphs: [
          "Your technician measures your scalp, matches your colour against samples in daylight, including how much grey you have, and draws the hairline on your forehead in pencil for you to agree. You choose the base together, and you hear the price before anything is fitted.",
        ],
      },
      {
        heading: "The fit",
        paragraphs: [
          "At the same visit or a later one, your choice, the hair under the base is trimmed short rather than shaved, the hair system is bonded to the skin, then cut into your own hair and styled. You see the result in the mirror before your technician leaves.",
        ],
      },
      {
        heading: "Where it happens",
        paragraphs: [
          "At your home, at a time that suits you. All you need is a chair near good light and somewhere to wash hair.",
        ],
      },
    ],
  },
  {
    slug: "looking-after-a-hair-system",
    publish: false,
    title: "Looking after a hair system",
    description: "Daily care for a hair system, what to do after a swim, and what happens at the monthly visit.",
    lead: "A few habits at home, and a visit about once a month.",
    sections: [
      {
        heading: "Every day",
        paragraphs: [
          "Wash and style it like your own hair, gently. It does not grow, so the cut stays as it was left.",
          "Heavy sweating is fine. After a swim in chlorine or the sea, rinse it in fresh water: both shorten the life of the base.",
        ],
      },
      {
        heading: "The monthly visit",
        paragraphs: [
          `Your technician comes back about once a month, lifts the hair system, cleans the base and your scalp, bonds it again and re-cuts it. It takes ${visitLength.service}, and it is what keeps it looking like the day it was fitted.`,
        ],
      },
      {
        heading: "When it is time for a new one",
        paragraphs: [
          "The base wears before the hair does. When it does, your technician tells you, and a new hair system is matched to the last so nobody notices the change.",
        ],
      },
    ],
  },
  {
    slug: "how-long-a-hair-system-lasts",
    publish: false,
    title: "How long a hair system lasts",
    description:
      "A hair system lasts months, not years. What decides how long yours lasts, and how to make it last longer.",
    lead: "Months, not years: the base wears before the hair does.",
    sections: [
      {
        heading: "What decides it",
        paragraphs: [
          "The base. A clear skin film is the most natural and the soonest to wear; a monofilament mesh outlasts every other base. Heat, sweat, sea water and chlorine all shorten it, and so does skipping the monthly visit.",
        ],
      },
      {
        heading: "How to make it last",
        paragraphs: [
          "Rinse it in fresh water after a swim, keep the monthly visit, and let your technician choose a base that suits how you live: a lace top for the gym and a Delhi summer, a skin base where nothing must show.",
        ],
      },
      {
        heading: "What we tell you",
        paragraphs: [
          "Your technician tells you what to expect from the base you choose at the consultation, before anything is fitted.",
        ],
      },
    ],
  },
  {
    slug: "what-a-hair-system-costs",
    publish: false,
    title: "What decides what a hair system costs",
    description:
      "What decides the price of a hair system, what you pay for and when, and why you hear the price before anything is fitted.",
    lead: "You hear the price at the free consultation, before anything is fitted or paid.",
    sections: [
      {
        heading: "What you pay for",
        paragraphs: [
          "The hair system itself, and the visits you take: the fit, then a visit about once a month. No consultation fee, no deposit and no package.",
        ],
      },
      {
        heading: "What decides the price",
        paragraphs: [
          "The base most of all: lace, monofilament and skin are made differently and last differently. The size of the area to cover and the density matched to your own hair matter too.",
        ],
      },
      {
        heading: "When you hear it",
        paragraphs: [
          "At the free consultation, from your technician, before anything is fitted. If it is not for you, you owe nothing.",
        ],
      },
    ],
  },
];

/** The cities we come to, as the home page's questions name them; the served pincodes decide the streets. */
export const areasPage = {
  publish: false,
  pageTitle: "Where we come · Mane Man",
  description: "Mane Man fits hair systems at home across Delhi NCR: Gurgaon, Delhi, Noida, Faridabad and Ghaziabad.",
  title: "Where we come",
  lead: "Your technician comes to your home, anywhere we serve in Delhi NCR.",
  cities: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
  /** Beneath the list: the pincodes we serve decide the streets, so a visitor checks theirs. */
  streets: "Within each city, the pincodes we serve decide the streets. Check yours to see the days we can come.",
  next: "Mumbai and Bengaluru are next. Leave your number on the booking page and we will tell you when a technician is working in your city.",
  check: "Check your pincode",
};

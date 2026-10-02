// The site's prices (docs/decisions/0073-prices-from-the-price-book.md). A sentence that gives a price holds a hole
// for each figure, "{firstFit}, then {service} a month", and the words here fill it. A page is built with the
// figures in src/content/prices.ts; mm-site's Worker fills the same sentences again from the price book, and the
// booking form's island does the same with what the Worker gives it. All three use these words, so they agree.
//
// A first fit is priced only as the hair systems ops offer in the console: {firstFit} is the cheapest of them, and
// {firstFitRange} runs from it to the dearest. While ops offer none there are no first-fit words, so a clause that
// needs one, "[ From {firstFit}.]", is left out, and a sentence that needs one says nothing.

import { rupees } from "@maneman/web-kit/money";
import { BUILT_PRICES, type SitePrices } from "../content/prices.ts";
import type { PublishedPrices } from "./api.ts";
import { fill } from "./text.ts";

/** "Twelve monthly service visits": the first year is the first fit and a service visit a month. */
const FIRST_YEAR_SERVICE_VISITS = 12;

/** The holes a sentence may give a price in: a service visit's and a replacement's always, a first fit's once offered. */
const STANDARD_HOLES = ["service", "replacement"] as const;
const FIRST_FIT_HOLES = ["firstFit", "firstYear", "firstFitRange"] as const;
const PRICE_HOLES = [...STANDARD_HOLES, ...FIRST_FIT_HOLES];

export type PriceWords = Readonly<Record<(typeof STANDARD_HOLES)[number], string>> &
  Readonly<Partial<Record<(typeof FIRST_FIT_HOLES)[number], string>>>;

/** The words for every hole: a service visit's and a replacement's, and a first fit's while ops offer a hair system. */
export function priceWords(prices: SitePrices): PriceWords {
  const words = { service: rupees(prices.service), replacement: rupees(prices.replacement) };
  if (prices.firstFits.length === 0) return words;
  const cheapest = Math.min(...prices.firstFits);
  const dearest = Math.max(...prices.firstFits);
  return {
    ...words,
    firstFit: rupees(cheapest),
    firstYear: rupees(cheapest + FIRST_YEAR_SERVICE_VISITS * prices.service),
    firstFitRange: cheapest === dearest ? rupees(cheapest) : `${rupees(cheapest)}–${rupees(dearest)}`,
  };
}

/** The words a page is built with: the Worker writes the book's over them. */
export const BUILT_WORDS: PriceWords = priceWords(BUILT_PRICES);

/** A clause given only where every price in it is known: "[ From {firstFit}.]". */
const CLAUSE = /\[([^\]]*)\]/g;
const HOLE = /\{(\w+)\}/g;

/** Whether every hole in `text` has its words. */
function known(text: string, words: PriceWords): boolean {
  const said: Readonly<Record<string, string | undefined>> = words;
  return [...text.matchAll(HOLE)].every(([, hole]) => hole !== undefined && said[hole] !== undefined);
}

/**
 * A sentence with its prices filled. A clause in [ ] is left out unless every price in it is known; a sentence
 * that needs a price not known outside one says nothing, as a first-fit figure does while ops offer no hair system.
 */
export function fillPrices(sentence: string, words: PriceWords): string {
  const kept = sentence.replace(CLAUSE, (_, clause: string) => (known(clause, words) ? clause : ""));
  return known(kept, words) ? fill(kept, words) : "";
}

/** Whether a sentence gives a price: whether it holds one of the holes above. */
export function holdsAPrice(text: string): boolean {
  return PRICE_HOLES.some((hole) => text.includes(`{${hole}}`));
}

/** A sentence as the page is built: any price in it filled with the build's figures, and no first fit's. */
export function asBuilt(text: string): string {
  return fillPrices(text, BUILT_WORDS);
}

/** The data-price attribute of a sentence's element: the sentence itself, for the Worker to fill again, if it gives a price. */
export function priceTemplate(text: string): string | undefined {
  return holdsAPrice(text) ? text : undefined;
}

/** The hair systems the book's answer offers as first fits, in the console's order. */
export function hairSystemsIn(answer: PublishedPrices): PublishedPrices["services"] {
  return answer.services.filter((service) => service.type === "first_fit");
}

/** The prices from the book's answer, each figure before GST, the main figure (src/policy/prices.ts). */
export function pricesOf(answer: PublishedPrices): SitePrices {
  return {
    firstFits: hairSystemsIn(answer).map((service) => service.price.amount_ex_gst),
    service: answer.service.amount_ex_gst,
    replacement: answer.replacement.amount_ex_gst,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPrice(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isInteger(value.amount_ex_gst) &&
    Number.isInteger(value.amount) &&
    typeof value.gst_percent === "number"
  );
}

/** A service as the answer lists it: its kind, its code, and its price. */
function isService(value: unknown): boolean {
  return isRecord(value) && typeof value.type === "string" && typeof value.tier === "string" && isPrice(value.price);
}

/** An answer from GET /api/published-prices that reads as one. Anything else is treated as no answer at all. */
export function isPublishedPrices(value: unknown): value is PublishedPrices {
  return (
    isRecord(value) &&
    value.tier === "standard" &&
    typeof value.on === "string" &&
    isPrice(value.service) &&
    isPrice(value.replacement) &&
    Array.isArray(value.services) &&
    value.services.every(isService)
  );
}

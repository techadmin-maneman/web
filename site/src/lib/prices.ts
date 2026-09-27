// The site's prices (docs/decisions/0073-prices-from-the-price-book.md). A sentence that gives a price holds a hole
// for each figure, "{firstFit}, then {service} a month", and the words here fill it. A page is built with the
// figures in src/content/prices.ts; mm-site's Worker fills the same sentences again from the price book, and the
// booking form's island does the same with what the Worker gives it. All three use these words, so they agree.
//
// Premium is the book's too: the services ops code premium in the console (docs/decisions/0085-services-ops-can-edit.md).
// While the book prices no premium first fit there are no premium words, so a clause that needs one, "[ Premium:
// {premiumFirstFit}.]", is left out, and an element that shows one stays hidden (data-premium, site/src/worker.ts).

import { rupeeSign } from "@maneman/web-kit/money";
import { BUILT_STANDARD, type TierPrices } from "../content/prices.ts";
import type { PublishedPrices } from "./api.ts";
import { fill } from "./text.ts";

/** "Twelve monthly service visits": the first year is the first fit and a service visit a month. */
const FIRST_YEAR_SERVICE_VISITS = 12;

/** The code a premium service carries within its kind, as the console makes it from the name "Premium". */
const PREMIUM_TIER = "premium";

/** The holes a sentence may give a price in: the standard tier's always, premium's once the book prices it. */
const STANDARD_HOLES = ["firstFit", "service", "replacement", "firstYear", "firstFitRange"] as const;
const PREMIUM_HOLES = ["premiumFirstFit", "premiumService", "premiumReplacement", "premiumFirstYear"] as const;
const PRICE_HOLES = [...STANDARD_HOLES, ...PREMIUM_HOLES];

export type PriceWords = Readonly<Record<(typeof STANDARD_HOLES)[number], string>> &
  Readonly<Partial<Record<(typeof PREMIUM_HOLES)[number], string>>>;

function firstYear(tier: TierPrices): number {
  return tier.first_fit + FIRST_YEAR_SERVICE_VISITS * tier.service;
}

/** The words for every hole, from the standard tier's figures and, where the book prices one, the premium tier's. */
export function priceWords(standard: TierPrices, premium: TierPrices | null = null): PriceWords {
  const words = {
    firstFit: rupeeSign(standard.first_fit),
    service: rupeeSign(standard.service),
    replacement: rupeeSign(standard.replacement),
    firstYear: rupeeSign(firstYear(standard)),
    firstFitRange: rupeeSign(standard.first_fit),
  };
  if (premium === null) return words;
  const cheaperFirstFit = Math.min(standard.first_fit, premium.first_fit);
  const dearerFirstFit = Math.max(standard.first_fit, premium.first_fit);
  return {
    ...words,
    firstFitRange: `${rupeeSign(cheaperFirstFit)}–${rupeeSign(dearerFirstFit)}`,
    premiumFirstFit: rupeeSign(premium.first_fit),
    premiumService: rupeeSign(premium.service),
    premiumReplacement: rupeeSign(premium.replacement),
    premiumFirstYear: rupeeSign(firstYear(premium)),
  };
}

/** The words a page is built with: the Worker writes the book's over them. */
export const BUILT_WORDS: PriceWords = priceWords(BUILT_STANDARD);

/** A clause given only where every price in it is known: "[ Premium: {premiumFirstFit}.]". */
const CLAUSE = /\[([^\]]*)\]/g;
const HOLE = /\{(\w+)\}/g;

/** Whether every hole in `text` has its words. */
function known(text: string, words: PriceWords): boolean {
  const said: Readonly<Record<string, string | undefined>> = words;
  return [...text.matchAll(HOLE)].every(([, hole]) => hole !== undefined && said[hole] !== undefined);
}

/**
 * A sentence with its prices filled. A clause in [ ] is left out unless every price in it is known; a sentence
 * that needs a price not known outside one says nothing, as a premium figure does while the book prices no premium.
 */
export function fillPrices(sentence: string, words: PriceWords): string {
  const kept = sentence.replace(CLAUSE, (_, clause: string) => (known(clause, words) ? clause : ""));
  return known(kept, words) ? fill(kept, words) : "";
}

/** Whether a sentence gives a price: whether it holds one of the holes above. */
export function holdsAPrice(text: string): boolean {
  return PRICE_HOLES.some((hole) => text.includes(`{${hole}}`));
}

/** A sentence as the page is built: any price in it filled with the build's figures, and no premium. */
export function asBuilt(text: string): string {
  return fillPrices(text, BUILT_WORDS);
}

/** The data-price attribute of a sentence's element: the sentence itself, for the Worker to fill again, if it gives a price. */
export function priceTemplate(text: string): string | undefined {
  return holdsAPrice(text) ? text : undefined;
}

/** The standard tier from the book's answer: each figure before GST, the main figure (src/policy/prices.ts). */
export function standardOf(answer: PublishedPrices): TierPrices {
  return {
    first_fit: answer.first_fit.amount_ex_gst,
    service: answer.service.amount_ex_gst,
    replacement: answer.replacement.amount_ex_gst,
  };
}

/**
 * The premium tier from the book's answer, each figure before GST: the first fit coded premium, and the service visit
 * and replacement coded premium where the console offers them, else the kind's standard one, which is what a client
 * with a premium base then books. Null while the book prices no premium first fit, and the site shows no Premium.
 */
export function premiumOf(answer: PublishedPrices): TierPrices | null {
  // An answer from an mm-api that publishes no services yet has none (docs/decisions/0085-services-ops-can-edit.md).
  const services = Array.isArray(answer.services) ? answer.services : [];
  const premium = (kind: "first_fit" | "service" | "replacement") =>
    services.find((service) => service.type === kind && service.tier === PREMIUM_TIER)?.price.amount_ex_gst;
  const firstFit = premium("first_fit");
  if (firstFit === undefined) return null;
  const standard = standardOf(answer);
  return {
    first_fit: firstFit,
    service: premium("service") ?? standard.service,
    replacement: premium("replacement") ?? standard.replacement,
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

/**
 * An answer from GET /api/published-prices that reads as one. Anything else is treated as no answer at all. One
 * without its list of services is still read, as an mm-api from before it would answer; one with a list it cannot
 * read is not.
 */
export function isPublishedPrices(value: unknown): value is PublishedPrices {
  return (
    isRecord(value) &&
    value.tier === "standard" &&
    typeof value.on === "string" &&
    isPrice(value.first_fit) &&
    isPrice(value.service) &&
    isPrice(value.replacement) &&
    (value.services === undefined || (Array.isArray(value.services) && value.services.every(isService)))
  );
}

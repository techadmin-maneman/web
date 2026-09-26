// The site's prices (docs/decisions/0073-prices-from-the-price-book.md). A sentence that gives a price holds a hole
// for each figure, "{firstFit}, then {service} a month", and the words here fill it. A page is built with the
// figures in src/content/prices.ts; mm-site's Worker fills the same sentences again from the price book, and the
// booking form's island does the same with what the Worker gives it. All three use these words, so they agree.

import { BUILT_STANDARD, PREMIUM, type TierPrices } from "../content/prices.ts";
import type { PublishedPrices } from "./api.ts";
import { fill } from "./text.ts";

/** "Twelve monthly service visits": the first year is the first fit and a service visit a month. */
const FIRST_YEAR_SERVICE_VISITS = 12;

/** The holes a sentence may give a price in. */
const PRICE_HOLES = [
  "firstFit",
  "service",
  "replacement",
  "firstYear",
  "premiumFirstFit",
  "premiumService",
  "premiumReplacement",
  "premiumFirstYear",
  "firstFitRange",
] as const;

export type PriceWords = Readonly<Record<(typeof PRICE_HOLES)[number], string>>;

const wholeRupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const withPaise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 3000000 paise → "₹30,000", grouped as India groups: "₹1,00,000". */
export function rupeeFigure(paise: number): string {
  const format = paise % 100 === 0 ? wholeRupees : withPaise;
  return `₹${format.format(paise / 100)}`;
}

function firstYear(tier: TierPrices): number {
  return tier.first_fit + FIRST_YEAR_SERVICE_VISITS * tier.service;
}

/** The words for every hole, from the standard tier's figures and the owner's Premium ones. */
export function priceWords(standard: TierPrices): PriceWords {
  const cheaperFirstFit = Math.min(standard.first_fit, PREMIUM.first_fit);
  const dearerFirstFit = Math.max(standard.first_fit, PREMIUM.first_fit);
  return {
    firstFit: rupeeFigure(standard.first_fit),
    service: rupeeFigure(standard.service),
    replacement: rupeeFigure(standard.replacement),
    firstYear: rupeeFigure(firstYear(standard)),
    premiumFirstFit: rupeeFigure(PREMIUM.first_fit),
    premiumService: rupeeFigure(PREMIUM.service),
    premiumReplacement: rupeeFigure(PREMIUM.replacement),
    premiumFirstYear: rupeeFigure(firstYear(PREMIUM)),
    firstFitRange: `${rupeeFigure(cheaperFirstFit)}–${rupeeFigure(dearerFirstFit)}`,
  };
}

/** The words a page is built with: the Worker writes the book's over them. */
export const BUILT_WORDS: PriceWords = priceWords(BUILT_STANDARD);

/** Whether a sentence gives a price: whether it holds one of the holes above. */
export function holdsAPrice(text: string): boolean {
  return PRICE_HOLES.some((hole) => text.includes(`{${hole}}`));
}

/** A sentence as the page is built: any price in it filled with the build's figures. */
export function asBuilt(text: string): string {
  return fill(text, BUILT_WORDS);
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

/** An answer from GET /api/published-prices that reads as one. Anything else is treated as no answer at all. */
export function isPublishedPrices(value: unknown): value is PublishedPrices {
  return (
    isRecord(value) &&
    value.tier === "standard" &&
    typeof value.on === "string" &&
    isPrice(value.first_fit) &&
    isPrice(value.service) &&
    isPrice(value.replacement)
  );
}

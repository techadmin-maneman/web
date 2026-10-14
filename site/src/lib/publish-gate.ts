// The production build's gate (docs/site.md). A production build stops if
// a published block still holds the design's placeholder material, if a
// consent notice or a legal page's wording has not been approved, if a price
// is typed into the site's or the landing's copy, which give none
// (docs/decisions/0204-the-sites-price-pipeline-removed.md), or if a count of the
// visits a referral earns is typed rather than built from what ops set
// (docs/decisions/0107-referral-rewards-in-the-console.md). Staging builds never run it.

import { DESIGN_PLACEHOLDERS, type PlaceholderBlockName } from "../content/design-placeholders.ts";
import * as guides from "../content/guides.ts";
import { referral } from "../content/referral.ts";
import * as site from "../content/site.ts";

type Block = { readonly publish: boolean };

/** Each placeholder block in site.ts, by the name design-placeholders.ts knows it by. */
const BLOCKS: Record<PlaceholderBlockName, Block> = {
  whatsapp: site.whatsapp,
  heroFootage: site.heroFootage,
  whatPlate: site.whatPlate,
  norwoodPhotos: site.norwoodPhotos,
  teaserPair: site.teaserPair,
  stepPhotos: site.stepPhotos,
  basePhotos: site.basePhotos,
  technicians: site.technicians,
  testimonials: site.testimonials,
  founderNote: site.founderNote,
  privacy: site.legalPages.privacy,
  terms: site.legalPages.terms,
};

/** Blocks production cannot do without: the consent screen links to /privacy. */
const REQUIRED: readonly PlaceholderBlockName[] = ["privacy", "terms"];

/** Every string anywhere inside a value. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

/**
 * "Rs." or a rupee sign before a digit: a price written into a sentence. The apps write "Rs." (ADR 0025); the rupee
 * sign, which the site wrote before, is caught too.
 */
const TYPED_PRICE = /(?:Rs\.|₹)\s?\d/;

/**
 * The comparison's first two columns, what a transplant and medication cost elsewhere: the only rupee figures the
 * site gives that are not our prices.
 */
const OTHER_PEOPLES_PRICES: ReadonlySet<string> = new Set(
  site.comparison.rows
    .flatMap((row): site.ComparisonCell[] => row.cells.slice(0, 2))
    .filter((cell): cell is string => typeof cell === "string"),
);

/** Every price the pages give that is typed by hand. */
function typedPrices(pages: readonly unknown[]): string[] {
  return pages.flatMap(stringsIn).filter((text) => TYPED_PRICE.test(text) && !OTHER_PEOPLES_PRICES.has(text));
}

/** A count of visits in figures written into a sentence, "3 service visits", where what a referral earns should build it. */
const VISITS_IN_FIGURES = /\b\d+ (?:service )?visits?\b/;

/**
 * A count in words, only where a reward is said of it: "three service visits free", "the three visits land". The site
 * rightly writes "twelve service visits" for a year of them and "in one visit" for the fit, which are no reward.
 */
const REWARD_IN_WORDS =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:service )?visits? (?:free|lands?|do(?:es)? not apply)\b/i;

/** Every count of visits the pages give that is typed by hand. */
function typedVisits(pages: readonly unknown[]): string[] {
  return pages.flatMap(stringsIn).filter((text) => VISITS_IN_FIGURES.test(text) || REWARD_IN_WORDS.test(text));
}

export function publishProblems(
  blocks: Readonly<Record<PlaceholderBlockName, Block>> = BLOCKS,
  notices: Readonly<Record<string, site.Notice>> = site.notices,
  pages: readonly unknown[] = [site, referral, guides],
  legalPages: Readonly<Record<string, { readonly approved: boolean }>> = site.legalPages,
): string[] {
  const problems: string[] = [];
  for (const [name, block] of Object.entries(blocks) as [PlaceholderBlockName, Block][]) {
    if (!block.publish) {
      if (REQUIRED.includes(name)) problems.push(`the ${name} page is not published: production needs its text`);
      continue;
    }
    const placeholders: readonly string[] = DESIGN_PLACEHOLDERS[name];
    const left = stringsIn(block).filter((value) => placeholders.includes(value));
    if (left.length > 0) {
      problems.push(`${name} is published but still holds the design's placeholder material: ${left.join(" | ")}`);
    }
  }
  for (const [name, notice] of Object.entries(notices)) {
    if (!notice.approved) problems.push(`the ${name} notice (${notice.version}) is not approved`);
  }
  for (const [name, page] of Object.entries(legalPages)) {
    if (!page.approved) problems.push(`the ${name} page's wording is not approved`);
  }
  for (const price of typedPrices(pages)) {
    problems.push(
      `a price is typed by hand, "${price}": the site gives no price of ours ` +
        "(docs/decisions/0204-the-sites-price-pipeline-removed.md)",
    );
  }
  for (const count of typedVisits(pages)) {
    problems.push(
      `a count of visits is typed by hand, "${count}": what a referral earns is set in the console ` +
        "(docs/decisions/0107-referral-rewards-in-the-console.md)",
    );
  }
  return problems;
}

/** Stops the build on these problems and any others the caller found, the content gate's among them. */
export function assertPublishable(more: readonly string[] = []): void {
  const problems = [...publishProblems(), ...more];
  if (problems.length > 0) {
    throw new Error(
      `The production build is blocked (docs/site.md):\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
  }
}

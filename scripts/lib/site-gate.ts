// The production site's publish gate, end to end (scripts/ci/site-production-gate.ts): what its build, made as it
// will be once the site goes live, must refuse, by the gate's own reasons (site/src/lib/publish-gate.ts,
// ./content-gate.ts), and what a build that passes must not ship. Until counsel approves the notices and legal pages
// that wait for them, the build refuses those and nothing else.

import { readdirSync, readFileSync } from "node:fs";
import { DESIGN_PLACEHOLDERS } from "../../site/src/content/design-placeholders.ts";
import { publishProblems } from "../../site/src/lib/publish-gate.ts";
import { CONTENT_FILES, contentProblems } from "./content-gate.ts";

/** Every reason the gate stops a production build today. */
export const refusals = (): string[] => [...publishProblems(), ...contentProblems(CONTENT_FILES.site)];

/** A reason that only counsel's approval clears: a notice or a legal page not yet approved, or words marked as such. */
export const awaitsApproval = (problem: string): boolean =>
  / is not approved$|’s wording is not approved$| lines marked PLACEHOLDER, at /.test(problem);

/** The reasons, one a line, a refused build gave. */
export const refusedFor = (output: string): string[] =>
  output
    .split("\n")
    .filter((line) => line.startsWith("  - "))
    .map((line) => line.slice(4));

/**
 * Pages that stay out of search engines: the 404, the referral landing, whose address holds an invite code, and /stop,
 * whose address holds the token that stops a person's messages.
 */
const NOT_INDEXED = new Set(["404.html", "r.html", "stop.html"]);

/** What a passing build, in `out`, shipped of the design's placeholder material, or of a page kept from search. */
export function shippedPlaceholders(out: string): string[] {
  const problems: string[] = [];
  const pages = readdirSync(out).filter((file) => file.endsWith(".html"));
  if (pages.length < 5) problems.push(`only ${String(pages.length)} pages were built`);
  const material = Object.values(DESIGN_PLACEHOLDERS).flat();
  const texts = material.filter((value) => value.length > 12);
  for (const page of pages) {
    const html = readFileSync(`${out}/${page}`, "utf8");
    if (html.includes(">Placeholder<")) problems.push(`${page} carries a placeholder tag`);
    if (!NOT_INDEXED.has(page) && html.includes("noindex")) problems.push(`${page} is kept out of search engines`);
    for (const value of texts) if (html.includes(value)) problems.push(`${page} holds the design's "${value}"`);
  }
  if (!readFileSync(`${out}/robots.txt`, "utf8").includes("Allow: /")) problems.push("robots.txt allows nothing");
  if (readFileSync(`${out}/_headers`, "utf8").includes("X-Robots-Tag")) problems.push("_headers keeps search out");
  // A placeholder photograph is not published by leaving it at a hashed address nothing links to.
  const files = readdirSync(`${out}/_astro`);
  for (const stem of material.filter((value) => /\.(jpg|mp4)$/.test(value)).map((file) => file.replace(/\.\w+$/, ""))) {
    for (const file of files.filter((each) => each.startsWith(`${stem}.`))) problems.push(`_astro/${file} was shipped`);
  }
  return problems;
}

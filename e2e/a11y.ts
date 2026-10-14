// What axe-core finds on a page against WCAG 2.2 AA, rule by rule. A test expects none.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The rules the page breaks. `scope` narrows or widens what axe reads, as `(axe) => axe.include("main")`. */
export async function axeViolations(
  page: Page,
  scope: (axe: AxeBuilder) => AxeBuilder = (axe) => axe,
): Promise<string[]> {
  // A colour fading between two states is judged at rest: under reduced motion nothing moves, on every surface.
  const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    const results = await scope(new AxeBuilder({ page }).withTags(WCAG_22_AA)).analyze();
    return results.violations.map((violation) => violation.id);
  } finally {
    if (!reduced) await page.emulateMedia({ reducedMotion: "no-preference" });
  }
}

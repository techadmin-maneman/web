// What axe-core finds on a page against WCAG 2.2 AA, rule by rule. A test expects none.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The rules the page breaks. `scope` narrows or widens what axe reads, as `(axe) => axe.include("main")`. */
export async function axeViolations(
  page: Page,
  scope: (axe: AxeBuilder) => AxeBuilder = (axe) => axe,
): Promise<string[]> {
  const results = await scope(new AxeBuilder({ page }).withTags(WCAG_22_AA)).analyze();
  return results.violations.map((violation) => violation.id);
}

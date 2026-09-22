// axe on every page and every screen, at both widths, against WCAG 2.2 AA.
//
// One known exception: v2 draws the try-on's countdown at 1.6:1 against its
// ground, under the 3:1 large text needs. It is raised with the owner (ADR
// 0022, 30) rather than changed, and is the only element axe skips.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const PAGES = [
  "/",
  "/try",
  "/try?state=consent",
  "/try?state=stage",
  "/try?state=looks",
  "/try?state=processing",
  "/try?state=gate",
  "/try?state=result",
  "/try?state=result&kind=returning",
  "/try?state=error",
  "/try?state=error&kind=lookLimit",
  "/book",
  "/book?state=booked",
  "/book?state=waitlist",
  "/privacy",
  "/terms",
  "/no-such-page",
];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).exclude("[data-countdown]").analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

for (const path of PAGES) {
  test(`${path} meets WCAG 2.2 AA`, async ({ page }) => {
    // The home page's islands wait to be scrolled to; axe reads the page as it arrives.
    if (path === "/") await page.goto(path);
    else await visit(page, path);
    expect(await violations(page)).toEqual([]);
  });
}

test("the forms' error states meet WCAG 2.2 AA", async ({ page }) => {
  await visit(page, "/try?state=gate");
  await page.getByLabel("Mobile").fill("98100");
  await page.getByRole("button", { name: "Show me the result" }).click();
  await expect(page.getByText("Tell us what to call you.")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await visit(page, "/book");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("Tell us what to call you.")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

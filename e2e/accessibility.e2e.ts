// axe on every page and every screen, at both widths, against WCAG 2.2 AA.
// Nothing is skipped: the try-on's countdown, which v2 draws at 1.6:1, is now
// drawn at 4.2:1 (ADR 0022, 30).

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
  "/try?state=result&kind=pending",
  "/try?state=error",
  "/try?state=error&kind=lookLimit",
  "/book",
  "/book?state=served",
  "/book?state=unserved",
  "/book?state=booked",
  "/book?state=requested",
  "/book?state=listed",
  "/book?state=expired",
  "/privacy",
  "/terms",
  // The referral landing: every /r/:code is the one page, and ?state= opens each state.
  "/r/RM4K7P",
  "/r/RM4K7P?state=served",
  "/r/RM4K7P?state=unserved",
  "/r/RM4K7P?state=booked",
  "/r/RM4K7P?state=requested",
  "/r/RM4K7P?state=expired",
  "/r/RM4K7P?state=listed",
  "/no-such-page",
];

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
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

  // The booking page is the referral landing without the invite: a pincode first,
  // then the form it decides on (docs/decisions/0051-booking-from-the-site.md).
  await visit(page, "/book?state=served");
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Please tell us your name.")).toBeVisible();
  await expect(page.getByText("Please give the building, society or street.")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await visit(page, "/book");
  await page.getByLabel("Pincode").fill("12");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That is not a six-digit Indian pincode.")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

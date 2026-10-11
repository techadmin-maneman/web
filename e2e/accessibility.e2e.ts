// axe on every page and every screen, at both widths, against WCAG 2.2 AA.
// Nothing is skipped.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";
import { WCAG_22_AA } from "./a11y.ts";

const PAGES = [
  "/",
  "/try",
  "/try?state=consent",
  "/try?state=stage",
  "/try?state=looks",
  "/try?state=gate",
  "/try?state=sent",
  "/try?state=sent&kind=returning",
  "/try?state=error",
  "/try?state=error&kind=unavailable",
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
  await page.getByRole("button", { name: "Send my look" }).click();
  await expect(page.getByText("Tell us what to call you, in letters.")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The booking page asks for the name and number first, then the pincode, the visit and the address
  // (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
  await visit(page, "/book");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter your name in letters.")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await visit(page, "/book?state=served");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Enter the building or society.")).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The invite's page has its pincode first.
  await visit(page, "/r/RM4K7P");
  await page.getByLabel("Pincode").fill("12");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That isn’t a six-digit Indian pincode.")).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

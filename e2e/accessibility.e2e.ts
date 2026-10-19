// axe on every page and every screen, at both widths, against WCAG 2.2 AA.
// Nothing is skipped.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";
import { atRest, WCAG_22_AA } from "./a11y.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";

const PAGES = [
  "/",
  "/try",
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
  siteCopy.NOTICES_PATH,
  "/terms",
  // Opened from a reminder's own link; with no token in the address, it says the link has run out.
  "/stop",
  // The guides and the cities, drafts on every build but production's.
  "/guides",
  "/guides/what-is-a-hair-system",
  "/areas",
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
  const results = await atRest(page, () => new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze());
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
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("98100");
  await page.getByRole("button", { name: siteCopy.tryOn.gate.submit }).click();
  await expect(page.getByText(siteCopy.tryOn.gate.nameError)).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The booking page asks for the name and number first, then the pincode, the visit and the address
  // (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
  await visit(page, "/book");
  await page.getByRole("button", { name: siteCopy.booking.start }).click();
  await expect(page.getByText(referralCopy.referral.form.nameError)).toBeVisible();
  expect(await violations(page)).toEqual([]);

  await visit(page, "/book?state=served");
  await page.getByRole("button", { name: siteCopy.booking.next }).click();
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
  await expect(page.getByText(referralCopy.referral.address.errors.line1)).toBeVisible();
  expect(await violations(page)).toEqual([]);

  // The invite's page has its pincode first.
  await visit(page, "/r/RM4K7P");
  await page.getByLabel(referralCopy.referral.pincode.label).fill("12");
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  await expect(page.getByText(referralCopy.referral.pincode.invalid)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

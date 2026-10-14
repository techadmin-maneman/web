// Every page links the privacy notice and the terms, and each form that takes a name and number says, beneath its
// agreement, that they apply, each a link.

import { expect, test } from "./support.ts";
import { referral } from "../site/src/content/referral.ts";

// Every page with a form among them: /book, /try, the invite and /stop.
for (const path of [
  "/",
  "/book",
  "/try",
  "/guides",
  "/guides/what-is-a-hair-system",
  "/areas",
  "/r/ROHIT123",
  "/stop",
]) {
  test(`${path} links the privacy notice and the terms`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('a[href="/privacy"]').first()).toBeAttached();
    await expect(page.locator('a[href="/terms"]').first()).toBeAttached();
  });
}

test("the booking form says the terms and privacy notice apply, beneath its agreement", async ({ page }) => {
  await page.goto("/book");
  const form = page.locator("form").first();
  await expect(form.getByRole("link", { name: referral.form.legal.terms })).toHaveAttribute("href", "/terms");
  await expect(form.getByRole("link", { name: referral.form.legal.privacy })).toHaveAttribute("href", "/privacy");
});

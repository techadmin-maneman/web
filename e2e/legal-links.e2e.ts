// Every page links the privacy notice and the terms, and each form that books asks the visitor to agree to them, each
// a link.

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

test("the booking form asks the visitor to agree to the terms and the privacy policy, each a link", async ({
  page,
}) => {
  await page.goto("/book");
  const form = page.locator("form").first();
  await expect(form.getByRole("checkbox", { name: Object.values(referral.form.agree).join("") })).not.toBeChecked();
  await expect(form.getByRole("link", { name: referral.form.agree.terms })).toHaveAttribute("href", "/terms");
  await expect(form.getByRole("link", { name: referral.form.agree.privacy })).toHaveAttribute("href", "/privacy");
});

// Every page links the privacy notice and the terms, and each form that books asks the visitor to agree to them, each
// a link.

import { expect, test } from "./support.ts";
import { referral } from "../site/src/content/referral.ts";

// Every page with a form among them: /book, /try, the invite and /stop; and, with no footer on a flow (ADR 0265), each
// screen of /book and the try-on past the first that has a ?state= preview, opened as it.
for (const path of [
  "/",
  "/book",
  "/book?state=served",
  "/book?state=unserved",
  "/book?state=booked",
  "/book?state=listed",
  "/try",
  "/try?state=looks",
  "/try?state=gate",
  "/try?state=sent",
  "/try?state=error",
  "/guides",
  "/guides/what-is-a-hair-system",
  "/areas",
  "/r/ROHIT123",
  "/stop",
  "/pay",
  "/pay/again",
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
  const named = { name: Object.values(referral.form.agree).join("") };
  await expect(form.getByRole("checkbox", named)).not.toBeChecked();
  // The tick's own links: the ad notice under the button links the privacy policy's section on it too.
  const agreement = form.locator("label").filter({ has: page.getByRole("checkbox", named) });
  await expect(agreement.getByRole("link", { name: referral.form.agree.terms })).toHaveAttribute("href", "/terms");
  await expect(agreement.getByRole("link", { name: referral.form.agree.privacy })).toHaveAttribute("href", "/privacy");
});

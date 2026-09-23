// Booking from the site against the real local mm-api: the pincode decides, the
// slot is held, and an unserved pincode takes the number instead
// (docs/decisions/0051-booking-from-the-site.md). e2e/book.e2e.ts covers every
// answer the API can give, against a mocked one.

import { expect, fakeTurnstile, randomMobile, test, visit } from "./support.ts";
import { SERVED, UNSERVED } from "./booking-area.ts";

/** Tomorrow in India, the first day the form offers. */
function tomorrow(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [year = 0, month = 1, day = 1] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

test("a served pincode books a real date and window", async ({ page }) => {
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(`We come to ${SERVED.area}`)).toBeVisible();

  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText(SERVED.area, { exact: false })).toBeVisible();
  // The day the strip opens on is tomorrow, and the API answers with the day it booked.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    new Date(`${tomorrow()}T00:00:00Z`).getUTCDate().toString(),
  );
});

test("a pincode we do not serve takes the number instead", async ({ page }) => {
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(`We are not in ${UNSERVED.area} yet`)).toBeVisible();

  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: `You are on the ${UNSERVED.area} list` })).toBeVisible();
});

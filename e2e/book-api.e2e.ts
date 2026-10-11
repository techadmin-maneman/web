// Booking from the site against the real local mm-api: the pincode decides, the
// slot is held, and an unserved pincode takes the number instead
// (docs/decisions/0051-booking-from-the-site.md). e2e/book.e2e.ts covers every
// answer the API can give, against a mocked one.

import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, randomMobile, test, visit } from "./support.ts";
import { fillAddress, SERVED, UNSERVED } from "./booking-area.ts";

/** Tomorrow in India, the first day the form offers. */
function tomorrow(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const [year = 0, month = 1, day = 1] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

/** /book's first step against the real API: the name and number kept as a lead (ADR 0116). */
async function leaveDetails(page: Page, consent: string): Promise<void> {
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  await page.getByText(consent).click();
  const kept = page.waitForResponse("**/api/lead");
  await page.getByRole("button", { name: "Continue" }).click();
  expect((await kept).status()).toBe(201);
}

test("a served pincode books a real date and window, at the address given", async ({ page }) => {
  await visit(page, "/book");
  await leaveDetails(page, "You may contact me on WhatsApp about this consultation.");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(`We come to ${SERVED.area}`)).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await fillAddress(page);
  const answered = page.waitForResponse("**/api/consultation");
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Booked", { exact: true })).toBeVisible();
  // The day the strip opens on is tomorrow, and the API answers with the day it booked.
  expect(await (await answered).json()).toMatchObject({ state: "booked", date: tomorrow() });
});

test("a pincode we do not serve takes the number instead", async ({ page }) => {
  await visit(page, "/book");
  await leaveDetails(page, "You may contact me on WhatsApp about this consultation.");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText(`We are not in ${UNSERVED.area} yet`)).toBeVisible();

  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: `You are on the ${UNSERVED.area} list` })).toBeVisible();
});

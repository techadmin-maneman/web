// The booking form and its two outcomes as F1 builds them (docs/feature-inventory.md,
// items 31–33). F2 replaces the stand-in submit with POST /api/lead.

import { expect, test, type Page } from "@playwright/test";

/** Opens a page and waits for its islands to hydrate: Astro drops [ssr] once one has. */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
}

async function fill(page: Page, city: string): Promise<void> {
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByLabel("City").selectOption(city);
  await page.getByText("I agree to be contacted about this visit.", { exact: false }).click();
}

test("the defaults are v2's: weekday evening, crown thinning, nothing ticked", async ({ page }) => {
  await visit(page, "/book");
  await expect(page.getByRole("radio", { name: "Weekday evening" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Crown thinning" })).toBeChecked();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("the mobile number is grouped five and five after a fixed +91", async ({ page }) => {
  await visit(page, "/book");
  await page.getByLabel("Mobile").fill("98100123456789");
  await expect(page.getByLabel("Mobile")).toHaveValue("98100 12345");
  await expect(page.getByText("+91", { exact: true })).toBeVisible();
});

test("cities come in the list's order, and an unserved one says it joins a list", async ({ page }) => {
  await visit(page, "/book");
  const options = await page.getByLabel("City").locator("option").allTextContents();
  expect(options).toEqual([
    "Gurgaon",
    "Delhi",
    "Noida",
    "Faridabad",
    "Ghaziabad",
    "Mumbai — coming soon",
    "Bengaluru — coming soon",
  ]);
  await page.getByLabel("City").selectOption("Mumbai");
  await expect(page.getByText("Not served yet — you will join the Mumbai list instead.")).toBeVisible();
});

test("an empty submit shows each error, announced", async ({ page }) => {
  await visit(page, "/book");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("Tell us what to call you.")).toBeVisible();
  await expect(page.getByText("Enter all ten digits so the technician can reach you.")).toBeVisible();
  await expect(page.getByText("Please agree to be contacted before we arrange a visit.")).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: "Tell us what to call you." })).toHaveCount(1);
});

test("while sending, the button reads Sending and cannot submit again", async ({ page }) => {
  await visit(page, "/book?state=sending");
  await expect(page.getByRole("button", { name: "Sending" })).toHaveAttribute("aria-disabled", "true");
});

test("a served city is booked, with the date, the window and the number", async ({ page }) => {
  await visit(page, "/book");
  await fill(page, "Gurgaon");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{1,2} [A-Z][a-z]+, after six\.$/,
  );
  await expect(page.getByText("He will confirm the hour on WhatsApp by tomorrow evening.")).toBeVisible();
  for (const term of ["What happens", "How long", "To pay", "Where", "Confirming to"]) {
    await expect(page.getByRole("term").filter({ hasText: term })).toHaveCount(1);
  }
  await expect(page.getByText("+91 98100 00000")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to calendar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/");
});

test("an unserved city joins its list", async ({ page }) => {
  await visit(page, "/book");
  await fill(page, "Mumbai");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("On the list", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We are across Delhi NCR, not yet in Mumbai.");
  await expect(page.getByText("First quarter, 2027")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the simulation meanwhile" })).toHaveAttribute("href", "/try");
});

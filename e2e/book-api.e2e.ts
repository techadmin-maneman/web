// Booking end to end against the real local API: its cities, its validation,
// its proposed date. The local mm-api runs the backend with stub providers
// (playwright.config.ts), and Turnstile's dummy token passes its test secret.

import { expect, fakeTurnstile, randomMobile, test, visit } from "./support.ts";

// One at a time: each booking makes the API ask Cloudflare to verify the
// token, and a burst of those from one machine can outrun the API's timeout.
test.describe.configure({ mode: "serial" });

/** The API gives Cloudflare's token check up to 5 s, and answers 503 after that; wait out both. */
const API_ANSWER_MS = 15_000;

test.beforeEach(async ({ page }) => {
  await fakeTurnstile(page);
});

test("the city list is the API's: five served cities, then the waitlisted ones", async ({ page }) => {
  await visit(page, "/book");
  await expect(page.getByLabel("City").locator("option")).toHaveText([
    "Gurgaon",
    "Delhi",
    "Noida",
    "Faridabad",
    "Ghaziabad",
    "Mumbai — coming soon",
    "Bengaluru — coming soon",
  ]);
});

test("a served city is booked with the API's proposed day and window", async ({ page }) => {
  await visit(page, "/book");
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  await page.getByLabel("City").selectOption("Noida");
  await page.getByText("I agree to be contacted about this visit.", { exact: false }).click();
  const answer = page.waitForResponse("**/api/lead", { timeout: API_ANSWER_MS });
  await page.getByRole("button", { name: "Request a visit" }).click();
  const response = await answer;
  expect(response.status()).toBe(201);
  const lead = (await response.json()) as { proposed_visit_date: string; window_label: string };
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    new RegExp(`^[A-Z][a-z]+day, ${String(Number(lead.proposed_visit_date.slice(8)))} [A-Z][a-z]+, after six\\.$`),
  );
  expect(lead.window_label).toBe("after six");
});

test("an unserved city joins the waitlist", async ({ page }) => {
  await visit(page, "/book");
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill(randomMobile());
  await page.getByLabel("City").selectOption("Bengaluru");
  await page.getByText("I agree to be contacted about this visit.", { exact: false }).click();
  const answer = page.waitForResponse("**/api/lead", { timeout: API_ANSWER_MS });
  await page.getByRole("button", { name: "Request a visit" }).click();
  expect((await answer).status()).toBe(201);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We are across Delhi NCR, not yet in Bengaluru.");
});

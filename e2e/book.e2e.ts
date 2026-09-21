// The booking form against a mocked API, so every answer the API can give is
// covered (docs/feature-inventory.md, items 31–33). e2e/book-api.e2e.ts books
// against the real local API.

import type { Page, Request } from "@playwright/test";
import { analyticsEvents, DUMMY_TOKEN, expect, expectNoPersonalData, fakeTurnstile, test, visit } from "./support.ts";

const CITIES = [
  { name: "Gurgaon", served: true },
  { name: "Delhi", served: true },
  { name: "Pune", served: false },
];

/** Mocks /api/cities and /api/lead; returns the lead requests the page made. */
async function mockApi(page: Page, lead: { status: number; body: unknown; delayMs?: number }): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await page.route("**/api/cities", (route) => route.fulfill({ json: CITIES }));
  await page.route("**/api/lead", async (route) => {
    requests.push(route.request());
    if (lead.delayMs !== undefined) await new Promise((done) => setTimeout(done, lead.delayMs));
    await route.fulfill({ status: lead.status, json: lead.body });
  });
  return requests;
}

const BOOKED = {
  status: 201,
  body: {
    lead_id: "4b1f3f0e-7c1d-4b5e-9d1a-3c2b1a0f9e8d",
    served: true,
    proposed_visit_date: "2026-09-25",
    window_label: "before noon",
  },
};

async function fillForm(page: Page, city = "Gurgaon"): Promise<void> {
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByLabel("City").selectOption(city);
  await page.getByText("I agree to be contacted about this visit.", { exact: false }).click();
}

test("the cities are the API's, in its order, and an unserved one says it joins a list", async ({ page }) => {
  await mockApi(page, BOOKED);
  await visit(page, "/book");
  await expect(page.getByLabel("City").locator("option")).toHaveText(["Gurgaon", "Delhi", "Pune — coming soon"]);
  await expect(page.getByLabel("City")).toHaveValue("Gurgaon");
  await page.getByLabel("City").selectOption("Pune");
  await expect(page.getByText("Not served yet — you will join the Pune list instead.")).toBeVisible();
});

test("the defaults are v2's: weekday evening, crown thinning, nothing ticked", async ({ page }) => {
  await mockApi(page, BOOKED);
  await visit(page, "/book");
  await expect(page.getByRole("radio", { name: "Weekday evening" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Crown thinning" })).toBeChecked();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("the mobile number is grouped five and five after a fixed +91", async ({ page }) => {
  await mockApi(page, BOOKED);
  await visit(page, "/book");
  await page.getByLabel("Mobile").fill("98100123456789");
  await expect(page.getByLabel("Mobile")).toHaveValue("98100 12345");
  await expect(page.getByText("+91", { exact: true })).toBeVisible();
});

test("an empty submit shows each error, announced, and sends nothing", async ({ page }) => {
  const requests = await mockApi(page, BOOKED);
  await visit(page, "/book");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("Tell us what to call you.")).toBeVisible();
  await expect(page.getByText("Enter all ten digits so the technician can reach you.")).toBeVisible();
  await expect(page.getByText("Please agree to be contacted before we arrange a visit.")).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: "Tell us what to call you." })).toHaveCount(1);
  expect(requests).toHaveLength(0);
});

test("sends the lead with the Turnstile token, a fresh idempotency key and the visit's attribution", async ({
  page,
}) => {
  const requests = await mockApi(page, BOOKED);
  await page.goto("/?utm_source=google&utm_campaign=launch&gclid=abc123");
  await visit(page, "/book");
  await fillForm(page);
  await page.getByRole("radio", { name: "Weekend morning" }).check({ force: true });
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friday, 25 September, before noon.");

  expect(requests).toHaveLength(1);
  const request = requests[0];
  expect(request?.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(request?.postDataJSON()).toEqual({
    name: "Test Visitor",
    mobile: "98100 00000",
    city: "Gurgaon",
    first_choice_window: "weekend_am",
    loss_extent: "crown",
    consent: true,
    turnstile_token: DUMMY_TOKEN,
    attribution: { landing_path: "/", utm_source: "google", utm_campaign: "launch", gclid: "abc123" },
  });
});

test("while sending, the button reads Sending and a second press sends nothing", async ({ page }) => {
  const requests = await mockApi(page, { ...BOOKED, delayMs: 800 });
  await visit(page, "/book");
  await fillForm(page);
  const button = page.getByRole("button", { name: "Request a visit" });
  await button.click();
  await expect(page.getByRole("button", { name: "Sending" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "Sending" }).click({ force: true });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Friday, 25 September, before noon.");
  expect(requests).toHaveLength(1);
});

test("booked: the API's date and window, the five rows, and a calendar file for the window", async ({ page }) => {
  await mockApi(page, BOOKED);
  await visit(page, "/book");
  await fillForm(page);
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("He will confirm the hour on WhatsApp by tomorrow evening.")).toBeVisible();
  for (const term of ["What happens", "How long", "To pay", "Where", "Confirming to"]) {
    await expect(page.getByRole("term").filter({ hasText: term })).toHaveCount(1);
  }
  await expect(page.getByText("+91 98100 00000")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the site" })).toHaveAttribute("href", "/");
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { first_choice_window: "weekday_pm", loss_extent: "crown", city: "Gurgaon", served: true }],
    ["booking_confirmed", { city: "Gurgaon" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "98100", "9810000000"]);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to calendar" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("mane-man-measurement.ics");
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString());
  expect(text).toContain("DTSTART:20260925T033000Z");
  expect(text).toContain("DTEND:20260925T063000Z");
  expect(text).toContain("SUMMARY:Mane Man measurement (time to be confirmed)");
});

test("booked without a proposed day: no date, no calendar file", async ({ page }) => {
  await mockApi(page, { status: 201, body: { lead_id: BOOKED.body.lead_id, served: true } });
  await visit(page, "/book");
  await fillForm(page);
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your measurement is booked.");
  await expect(page.getByRole("button", { name: "Add to calendar" })).toHaveCount(0);
});

test("an unserved city joins its list", async ({ page }) => {
  await mockApi(page, { status: 201, body: { lead_id: BOOKED.body.lead_id, served: false } });
  await visit(page, "/book");
  await fillForm(page, "Pune");
  await page.getByRole("button", { name: "Request a visit" }).click();
  await expect(page.getByText("On the list", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We are across Delhi NCR, not yet in Pune.");
  await expect(page.getByText("First quarter, 2027")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try the simulation meanwhile" })).toHaveAttribute("href", "/try");
  expect((await analyticsEvents(page)).map(([name]) => name)).toEqual(["lead_submitted", "waitlist_submitted"]);
  await expectNoPersonalData(page, ["Test Visitor", "98100", "9810000000"]);
});

const REFUSALS = [
  { status: 429, code: "rate_limited", text: "This number has asked for a visit several times today." },
  { status: 403, code: "turnstile_failed", text: "We could not check this browser. Please try again." },
  { status: 503, code: "unavailable", text: "That did not go through. Please try again in a minute." },
];
for (const refusal of REFUSALS) {
  test(`a ${refusal.code} refusal says so and keeps the form, and a retry uses a new key`, async ({ page }) => {
    const requests = await mockApi(page, {
      status: refusal.status,
      body: { error: { code: refusal.code, request_id: "r" } },
    });
    await visit(page, "/book");
    await fillForm(page);
    await page.getByRole("button", { name: "Request a visit" }).click();
    await expect(page.getByText(refusal.text, { exact: false })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Test Visitor");
    await page.getByRole("button", { name: "Request a visit" }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[0]?.headers()["idempotency-key"]).not.toBe(requests[1]?.headers()["idempotency-key"]);
  });
}

test("the city list failing to load says so", async ({ page }) => {
  await fakeTurnstile(page);
  await page.route("**/api/cities", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable" } } }),
  );
  await visit(page, "/book");
  await expect(page.getByText("The list of cities did not load. Please reload the page.")).toBeVisible();
});

test("the layout is v2's as it renders: the intro, then the form card below it", async ({ page }) => {
  await mockApi(page, BOOKED);
  await visit(page, "/book");
  const intro = await page.getByRole("heading", { name: "Book a free measurement" }).boundingBox();
  const card = await page.locator("form").boundingBox();
  expect(card?.y ?? 0).toBeGreaterThan((intro?.y ?? 0) + (intro?.height ?? 0));
  expect(Math.round(card?.x ?? 0)).toBe(Math.round(intro?.x ?? 0));
});

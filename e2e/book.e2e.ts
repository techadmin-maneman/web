// The site's own booking page against a mocked API, so every answer the API can
// give is covered (docs/decisions/0051-booking-from-the-site.md). It is the
// referral landing without the invite: e2e/refer-landing.e2e.ts covers that one,
// and e2e/book-api.e2e.ts books against the real local API.

import type { Page, Request } from "@playwright/test";
import { analyticsEvents, expect, expectNoPersonalData, fakeTurnstile, test, visit } from "./support.ts";

const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

const BOOKED = { state: "booked", date: "2026-09-25", window: "morning", area: SERVED.area };

/** Mocks the page's three calls; returns the requests it made. */
async function mockApi(
  page: Page,
  answers: { consultation?: { status: number; body: unknown }; waitlist?: { status: number; body: unknown } } = {},
): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await page.route("**/api/pincodes/*", (route) => {
    const pincode = route.request().url().split("/").pop();
    return route.fulfill({ json: pincode === SERVED.pincode ? SERVED : UNSERVED });
  });
  await page.route("**/api/consultation", (route) => {
    requests.push(route.request());
    const answer = answers.consultation ?? { status: 201, body: BOOKED };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route("**/api/waitlist", (route) => {
    requests.push(route.request());
    const answer = answers.waitlist ?? { status: 201, body: { area: UNSERVED.area } };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

test("the page introduces itself, with no invite and no card", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");

  await expect(page.getByRole("heading", { level: 1, name: "Book a free consultation" })).toBeVisible();
  await expect(page.getByText("sent you this")).toBeHidden();
  await expect(page.getByText("We do not recognise this invite")).toBeHidden();
  await expect(page.locator("img[width='1200']")).toHaveCount(0);
});

test("a served pincode books, and sends where the hair loss is", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("We come to Sector 65")).toBeVisible();

  await page.getByText("Receding front", { exact: true }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "morning", consent: true, loss_extent: "receding" });
  expect(sent.turnstile_token).toBeTruthy();
  // The invite's three visits are the landing's; this page promises nothing of the kind.
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

// Nobody invited them, so nothing on this page may speak of an invite or of the
// three visits that come with one.
test("says nothing about an invite to someone who came here directly", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  const invited = [/invited you/i, /3 visits/i, /3 service visits/i, /invite/i];

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  // The page is headed once, not twice: the form beneath it repeats nothing.
  await expect(page.getByRole("heading", { name: "Book a free consultation" })).toHaveCount(1);
  await expect(page.getByText("An hour. Nothing fitted, nothing to pay.")).toBeVisible();
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);

  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Add me to the list" })).toBeVisible();
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);
});

test("a pincode we do not serve takes the number, with the launch alert offered", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");

  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("We are not in Bandra yet")).toBeVisible();

  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me about this request.").click();
  await page.getByText("Tell me when you launch in my area.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ contact_consent: true, launch_alert: true });
});

// FEO-17: the lead is the conversion paid campaigns are bought for, whichever answer the pincode gave.
test("a booking and a waitlist are both counted, with nothing personal", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByText("Receding front", { exact: true }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "book", served: true, area: "Sector 65", window: "morning", loss_extent: "receding" }],
    ["booking_confirmed", { page: "book", area: "Sector 65", window: "morning", state: "booked" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000"]);

  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();
  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "book", served: false, area: "Bandra", window: null, loss_extent: "crown" }],
    ["waitlist_submitted", { page: "book", area: "Bandra" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000"]);
});

// While self-serve booking is off the page asks rather than books, and the day
// asked for waits for ops (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
test("booking through WhatsApp for now is confirmed as a request, not refused", async ({ page }) => {
  await mockApi(page, {
    consultation: {
      status: 201,
      body: { state: "requested", date: "2026-09-25", window: "morning", area: SERVED.area },
    },
  });
  await visit(page, "/book");

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation requested")).toBeVisible();
  await expect(page.getByText("We message you on WhatsApp to fix the hour.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeHidden();
});

test("an empty submit shows each error, announced, and sends nothing", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Please tell us your name.")).toBeVisible();
  await expect(page.getByText("Please enter a ten-digit mobile number.")).toBeVisible();
  await expect(page.getByText("We need this to contact you.")).toBeVisible();
  expect(requests).toHaveLength(0);
});

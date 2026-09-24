// The referral landing at /r/:code against a mocked API, so every answer it can
// give is covered (design/phase2/Referral and Waitlist, C1 to C4).
//
// The static server maps every /r/:code to the built page, as run_worker_first
// does behind Cloudflare. Nothing rewrites the invite into the page here, so the
// island fetches it — the same fallback that runs if the Worker cannot reach
// mm-api.

import type { Page, Request } from "@playwright/test";
import { expect, fakeTurnstile, test, visit } from "./support.ts";

const CODE = "RM4K7P";

const INVITE = {
  state: "valid" as const,
  referrer_first_name: "Rohit",
  card: { state: "personal" as const, version: 2 },
};

const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

interface Answers {
  invite?: typeof INVITE | { state: "unknown"; referrer_first_name: null; card: { state: "house"; version: number } };
  consultation?: { status: number; body: unknown };
  waitlist?: { status: number; body: unknown };
}

/** Mocks the landing's four calls; returns the requests the page made. */
async function mockApi(page: Page, answers: Answers = {}): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: answers.invite ?? INVITE }));
  await page.route("**/api/pincodes/*", (route) => {
    const pincode = route.request().url().split("/").pop();
    return route.fulfill({ json: pincode === SERVED.pincode ? SERVED : UNSERVED });
  });
  await page.route(`**/api/r/${CODE}/consultation`, (route) => {
    requests.push(route.request());
    const answer = answers.consultation ?? {
      status: 201,
      body: { state: "booked", date: "2026-09-25", window: "morning", area: SERVED.area, credits: true },
    };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route(`**/api/r/${CODE}/waitlist`, (route) => {
    requests.push(route.request());
    const answer = answers.waitlist ?? { status: 201, body: { area: UNSERVED.area, credits: true } };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

async function fillPerson(page: Page): Promise<void> {
  await page.getByLabel("Name").fill("Test Friend");
  await page.getByLabel("Mobile").fill("9810000000");
}

test("the invite names the referrer, and a served pincode opens the consultation", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await expect(page.getByText("Rohit sent you this")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hair, fitted at your home in Gurgaon.");
  await expect(page.getByText("Get fitted and you both get 3 service visits free.")).toBeVisible();

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("We come to Sector 65")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Book a free consultation" })).toBeVisible();
  await expect(page.getByText("Rohit is told when you are fitted. That is when the 3 visits land.")).toBeVisible();

  await fillPerson(page);
  // The radio itself is visually hidden, as the design has it: a person clicks its label.
  await page.getByText("Afternoon", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Afternoon/ })).toBeChecked();
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "afternoon", consent: true, mobile: "9810000000" });
  expect(sent.turnstile_token).toBeTruthy();
});

test("the invited page does say who is told, and what lands when", async ({ page }) => {
  await mockApi(page);
  await visit(page, `/r/${CODE}`);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Rohit is told when you are fitted. That is when the 3 visits land.")).toBeVisible();
});

test("an unserved pincode takes the number instead, and the launch alert is the visitor's choice", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  // The navy block says what the pincode answered, in place of the pincode field (board C3).
  await expect(page.getByText("We are not in Bandra yet")).toBeVisible();
  await expect(page.getByLabel("Pincode")).toBeHidden();
  await expect(page.getByText("For 400050, Bandra.")).toBeVisible();

  await fillPerson(page);
  await page.getByText("You may contact me about this request.").click();
  await page.getByText("Tell me when you launch in my area.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  await expect(page.getByText("Rohit’s invite holds for 12 months after that.")).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({
    pincode: UNSERVED.pincode,
    contact_consent: true,
    launch_alert: true,
  });
});

test("a code we do not know still books, without the invite's visits", async ({ page }) => {
  await mockApi(page, {
    invite: { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } },
    consultation: {
      status: 201,
      body: { state: "booked", date: "2026-09-25", window: "morning", area: SERVED.area, credits: false },
    },
  });
  await visit(page, `/r/${CODE}`);

  await expect(page.getByText("We do not recognise this invite")).toBeVisible();
  await expect(page.getByText("The consultation is still free; the 3 service visits do not apply.")).toBeVisible();
  await expect(page.getByText("Get fitted and you both get 3 service visits free.")).toBeHidden();

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Whoever invited you is told when you are fitted.", { exact: false })).toBeVisible();

  await fillPerson(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

// With self-serve booking off, the API records the day asked for and answers
// "requested" (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
// The friend sees the same frame, saying ops fix the hour, rather than an error
// that sends them away to type it all again.
test("a consultation nobody can book outright is confirmed as a request", async ({ page }) => {
  await mockApi(page, {
    consultation: {
      status: 201,
      body: { state: "requested", date: "2026-09-25", window: "morning", area: SERVED.area, credits: true },
    },
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillPerson(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation requested")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^You asked for /);
  await expect(page.getByText("We message you on WhatsApp to fix the hour.")).toBeVisible();
  // The invite still stands, and nothing says the visit is booked.
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  await expect(page.getByText("Consultation booked")).toBeHidden();
});

test("a pincode that is not six digits is refused before the API is asked", async ({ page }) => {
  let asked = false;
  await mockApi(page);
  await page.route("**/api/pincodes/*", (route) => {
    asked = true;
    return route.fulfill({ json: SERVED });
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill("12");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("That is not a six-digit Indian pincode.")).toBeVisible();
  expect(asked).toBe(false);
});

test("a window that has just gone says so, and the form stays", async ({ page }) => {
  await mockApi(page, {
    consultation: { status: 409, body: { error: { code: "taken", request_id: "r" } } },
  });
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillPerson(page);
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("That window has just gone. Please pick another.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
});

// The date strip scrolls sideways; the page must not. A hidden radio inside it is absolutely
// positioned, and without a positioned parent it is placed against the document and widens it.
test("the page does not scroll sideways, whatever the pincode says", async ({ page }) => {
  await mockApi(page);
  for (const pincode of [SERVED.pincode, UNSERVED.pincode]) {
    await visit(page, `/r/${CODE}`);
    await page.getByLabel("Pincode").fill(pincode);
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.getByRole("button", { name: /Book the consultation|Add me to the list/ })).toBeVisible();
    const width = page.viewportSize()?.width ?? 0;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test("the form will not send without a name, a number and the agreement", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, `/r/${CODE}`);

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Please tell us your name.")).toBeVisible();
  await expect(page.getByText("Please enter a ten-digit mobile number.")).toBeVisible();
  await expect(page.getByText("We need this to contact you.")).toBeVisible();
  expect(requests).toHaveLength(0);
});

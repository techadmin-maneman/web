import { axeViolations } from "./a11y.ts";
// The site's own booking page against a mocked API, so every answer the API can
// give is covered (docs/decisions/0051-booking-from-the-site.md). It is the
// referral landing without the invite: e2e/refer-landing.e2e.ts covers that one,
// and e2e/book-api.e2e.ts books against the real local API. It books with an
// invite only when this browser remembers one (docs/decisions/0089-an-invite-is-not-lost.md).

import type { Page, Request } from "@playwright/test";
import { fillAddress } from "./booking-area.ts";
import {
  analyticsEvents,
  enterNumberCode,
  expect,
  expectNoPersonalData,
  fakeTurnstile,
  mockNumberCode,
  NUMBER_CODE,
  NUMBER_CODE_ID,
  test,
  visit,
} from "./support.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";

const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

const BOOKED = {
  state: "booked",
  date: "2026-09-25",
  window: "morning",
  area: SERVED.area,
  credits: false,
  invite: "unknown",
  one_visit: false,
  discount_code: null,
};

const CODE = "RM4K7P";
const INVITE = {
  state: "valid",
  referrer_first_name: "Rohit",
  partner: null,
  friend_visits: null,
  discount: null,
  card: { state: "house", version: 1 },
};

type Answer = { status: number; body: unknown };

/** The form's question: which days and windows can be booked. */
const OPEN_WINDOWS = /\/api\/availability\/public\?/;
/** The page's clock for the tests that answer it: the strip opens on Saturday 3 October, as the answers do. */
const NOON_2_OCTOBER = new Date("2026-10-02T06:30:00Z");
const ALL_OPEN = { morning: true, afternoon: true, evening: true };
const FULL = { morning: false, afternoon: false, evening: false };
type Windows = typeof ALL_OPEN;

/** Fourteen days from Saturday 3 October 2026: the windows given for a day, else `otherwise`. */
function openDays(given: Record<string, Windows> = {}, otherwise: Windows = ALL_OPEN) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 3 + index)).toISOString().slice(0, 10);
    return { date, windows: given[date] ?? otherwise };
  });
}

/** Answers the form's question with the days for the plan asked about; returns the questions asked. */
async function answerOpen(page: Page, daysFor: (plan: string) => ReturnType<typeof openDays>): Promise<URL[]> {
  const asked: URL[] = [];
  await page.route(OPEN_WINDOWS, (route) => {
    const url = new URL(route.request().url());
    asked.push(url);
    const plan = url.searchParams.get("plan") ?? "";
    return route.fulfill({ json: { plan, days: daysFor(plan) } });
  });
  return asked;
}

/** Mocks the page's calls; returns the bookings and waitlist entries it sent. */
async function mockApi(page: Page, answers: { consultation?: Answer; waitlist?: Answer } = {}): Promise<Request[]> {
  const requests: Request[] = [];
  await fakeTurnstile(page);
  await mockNumberCode(page);
  // Unless a test gives the days open, the API cannot say, and the form draws every window open.
  await page.route(OPEN_WINDOWS, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await page.route("**/api/pincodes/*", (route) => {
    const pincode = route.request().url().split("/").pop();
    return route.fulfill({ json: pincode === SERVED.pincode ? SERVED : UNSERVED });
  });
  await page.route("**/api/lead", (route) => route.fulfill({ status: 201, json: {} }));
  await page.route("**/api/consultation", (route) => {
    requests.push(route.request());
    const answer = answers.consultation ?? { status: 201, body: BOOKED };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  await page.route("**/api/waitlist", (route) => {
    requests.push(route.request());
    const answer = answers.waitlist ?? {
      status: 201,
      body: { area: UNSERVED.area, credits: false, invite: "unknown" },
    };
    return route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

/** Opens a friend's invite, which this browser then remembers, before the page books. */
async function openInvite(page: Page): Promise<void> {
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: INVITE }));
  await visit(page, `/r/${CODE}`);
  await expect(page.getByText("Rohit sent you this")).toBeVisible();
}

const remembered = (page: Page) => page.evaluate(() => localStorage.getItem("mm_invite"));

/** Where the agreement on /book's first step, and on the consultation's, is ticked. */
const CONSULTATION_CONSENT = "You may contact me on WhatsApp about this consultation.";

/** /book's first step: the name, the number and the agreement, kept before anything else (ADR 0116). */
async function leaveDetails(page: Page, mobile = "9810000000"): Promise<void> {
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill(mobile);
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Pincode")).toBeFocused();
}

/** A pincode checked. */
async function checkPincode(page: Page, pincode: string): Promise<void> {
  await page.getByLabel("Pincode").fill(pincode);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
}

/** /book, at the pincode, its first step done. */
async function openAtPincode(page: Page): Promise<void> {
  await visit(page, "/book");
  await leaveDetails(page);
}

/** /book, for the served pincode, at the visit. */
async function openForm(page: Page): Promise<void> {
  await openAtPincode(page);
  await checkPincode(page, SERVED.pincode);
}

/** /book, for the pincode we do not serve, at the list. */
async function openWaitlist(page: Page): Promise<void> {
  await openAtPincode(page);
  await checkPincode(page, UNSERVED.pincode);
}

/** On from the visit to the address. */
async function toAddress(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Step 4 of 4 · Your address")).toBeFocused();
}

/** The address filled in and the booking sent. */
async function fillAndBook(page: Page): Promise<void> {
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
}

/** From the visit: on to the address, and booked. */
async function continueAndBook(page: Page): Promise<void> {
  await toAddress(page);
  await fillAndBook(page);
}

async function bookHere(page: Page): Promise<void> {
  await openForm(page);
  await continueAndBook(page);
}

/** The lead calls /book's first step makes, answered as the API answers every number. */
async function leadCalls(page: Page): Promise<Request[]> {
  const calls: Request[] = [];
  await page.route("**/api/lead", (route) => {
    calls.push(route.request());
    return route.fulfill({ status: 201, json: {} });
  });
  return calls;
}

/** What /book says beside the invite this browser remembers, before it sends it. */
const TOLD = "You have an invite. Whoever invited you is told when you are fitted. That is when the 3 visits land.";

test("the page introduces itself, with no invite and no card", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");

  await expect(page.getByRole("heading", { level: 1, name: "Book a free consultation" })).toBeVisible();
  await expect(page.getByText("sent you this")).toBeHidden();
  await expect(page.getByText("We do not recognise this invite")).toBeHidden();
  await expect(page.locator("img[width='1200']")).toHaveCount(0);
});

// Twelve fields stood between the visitor and the button, the name and number last, so anyone who stopped halfway
// left nothing behind (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
test("keeps the name and number first, then asks for the area, the visit and the address, a step at a time", async ({
  page,
}) => {
  const requests = await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");

  await expect(page.getByText("Step 1 of 4 · You")).toBeVisible();
  await expect(page.getByLabel("Pincode")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await leaveDetails(page);

  expect(leads).toHaveLength(1);
  const lead = leads[0]?.postDataJSON() as Record<string, unknown>;
  expect(lead).toMatchObject({ name: "Test Visitor", mobile: "9810000000", consent: true });
  expect(lead.turnstile_token).toBeTruthy();
  await expect(page.getByText("For Test Visitor, +91 98100 00000")).toBeVisible();
  await expect(page.getByText("Step 2 of 4 · Your area")).toBeVisible();

  await checkPincode(page, SERVED.pincode);
  await expect(page.getByText("Step 3 of 4 · Your visit")).toBeVisible();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name, { exact: true })).toHaveCount(0);
  await toAddress(page);
  await expect(page.getByLabel(siteCopy.tryOn.gate.name, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(siteCopy.tryOn.gate.mobile, { exact: true })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await fillAndBook(page);

  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ name: "Test Visitor", mobile: "9810000000", consent: true });
});

test("Change returns to the name and number as typed, and the same again is not kept twice", async ({ page }) => {
  await mockApi(page);
  const leads = await leadCalls(page);
  await openForm(page);

  await page.getByRole("button", { name: siteCopy.booking.changeYouLabel }).click();
  await expect(page.getByText("Step 1 of 4 · You")).toBeFocused();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveValue("98100 00000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Pincode")).toBeFocused();
  expect(leads).toHaveLength(1);

  await page.getByRole("button", { name: siteCopy.booking.changeYouLabel }).click();
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000001");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("For Test Visitor, +91 98100 00001")).toBeVisible();
  expect(leads).toHaveLength(2);
});

// The field kept the first ten digits, so "+91 98765 43210" was booked as 91987 65432, someone else's number.
test("a number with +91, 91, 0 or 0091 in front books its own ten digits, pasted or typed", async ({ page }) => {
  const requests = await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");

  const mobile = page.getByLabel(siteCopy.tryOn.gate.mobile);
  for (const typed of ["+91 98765 43210", "+919876543210", "919876543210", "09876543210", "0091 98765 43210"]) {
    await mobile.fill(typed);
    await expect(mobile).toHaveValue("98765 43210");
    await mobile.clear();
    await mobile.pressSequentially(typed);
    await expect(mobile).toHaveValue("98765 43210");
  }
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await checkPincode(page, SERVED.pincode);
  await continueAndBook(page);

  await expect(
    page.getByText("Your technician arrives in that window. Details are on WhatsApp at +91 98765 43210."),
  ).toBeVisible();
  expect(leads[0]?.postDataJSON()).toMatchObject({ mobile: "9876543210" });
  expect(requests[0]?.postDataJSON()).toMatchObject({ mobile: "9876543210" });
});

test("restates the day and window booked, says what the visit asks, and offers it to the calendar", async ({
  page,
}) => {
  await mockApi(page);
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: "Friday 25 September, 9 am to 12 pm" })).toBeVisible();
  await expect(page.getByText(referralCopy.referral.booked.ready.consultation)).toBeVisible();
  const google = new URL(
    (await page.getByRole("link", { name: referralCopy.referral.booked.calendar.google }).getAttribute("href")) ?? "",
  );
  expect(google.searchParams.get("dates")).toBe("20260925T033000Z/20260925T063000Z");
  expect(google.searchParams.get("text")).toBe("Mane Man consultation");
  const file = page.getByRole("link", { name: referralCopy.referral.booked.calendar.file });
  await expect(file).toHaveAttribute("download", "mane-man-visit.ics");
  const ics = decodeURIComponent((await file.getAttribute("href"))?.split(",")[1] ?? "");
  expect(ics).toContain("DTSTART:20260925T033000Z\r\nDTEND:20260925T063000Z");
});

test("a request waiting for ops to fix the hour offers no calendar", async ({ page }) => {
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, state: "requested" } } });
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: "We will message you" })).toBeVisible();
  await expect(page.getByRole("link", { name: referralCopy.referral.booked.calendar.google })).toHaveCount(0);
});

test("a served pincode books, and sends where the hair loss is", async ({ page }) => {
  const requests = await mockApi(page);
  await openAtPincode(page);
  await checkPincode(page, SERVED.pincode);
  await expect(page.getByText("We come to Sector 65")).toBeVisible();

  await toAddress(page);
  await fillAddress(page);
  await page.getByRole("radio", { name: "Receding front", exact: true }).check();
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();

  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "morning", consent: true, loss_extent: "receding" });
  expect(sent.turnstile_token).toBeTruthy();
  // The consultation alone, as the form starts (ADR 0105).
  expect(sent).not.toHaveProperty("one_visit");
  // The invite's three visits are the landing's; this page promises nothing of the kind.
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

// "We come to Masjid Moth", the post office's name for the area.
test("greets a served pincode by its city until ops name its area", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/pincodes/*", (route) => route.fulfill({ json: { ...SERVED, area: null } }));
  await openForm(page);
  await expect(page.getByRole("heading", { name: "We come to Gurgaon" })).toBeVisible();
});

// A consultation and fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the client chooses one visit or two. The second choice books the consultation and fit in one visit, three hours,
// paid for once fitted; it replaces the consultation with the first fit to follow, whose tests went with it.
test("offers the consultation and fit in one visit, and says what it holds", async ({ page }) => {
  const requests = await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true } } });
  await openForm(page);

  const plan = page.getByRole("group", { name: referralCopy.referral.consultation.plan.legend });
  await expect(plan.getByRole("radio")).toHaveCount(2);
  await plan.getByRole("radio", { name: "Consultation and fit · three hours" }).check();
  await expect(plan.getByRole("radio", { name: "Consultation and fit · three hours" })).toBeChecked();
  await expect(page.getByText(/^Starts in the morning or the afternoon\./)).toBeVisible();
  // The page's heading follows what it books.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteCopy.booking.titleOneVisit);
  expect(await axeViolations(page)).toEqual([]);

  await toAddress(page);
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submitOneVisit }).click();

  // Nothing is booked for the number until the WhatsApp code sent to it is entered.
  await expect(page.getByText("Sent on WhatsApp to +91 98100 00000.", { exact: false })).toBeVisible();
  await expect(page.getByLabel(siteCopy.numberCode.label)).toBeFocused();
  expect(requests).toHaveLength(0);
  expect(await axeViolations(page)).toEqual([]);
  await enterNumberCode(page, "Confirm and book");

  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ one_visit: true, window: "morning", consent: true, number_code_id: NUMBER_CODE_ID });
  // Where the hair loss is was skipped, so nothing is said of it.
  expect(sent).not.toHaveProperty("loss_extent");
});

test("books the one visit only with the right WhatsApp code", async ({ page }) => {
  const requests = await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true } } });
  const verified: unknown[] = [];
  await page.route("**/api/number-code/verify", (route) => {
    verified.push(route.request().postDataJSON());
    const right = verified.length > 1;
    return route.fulfill({ json: right ? { verified: true } : { verified: false, attempts_left: 4 } });
  });
  await openForm(page);
  await page
    .getByRole("group", { name: referralCopy.referral.consultation.plan.legend })
    .getByRole("radio", { name: "Consultation and fit · three hours" })
    .check();
  await toAddress(page);
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submitOneVisit }).click();

  await page.getByLabel(siteCopy.numberCode.label).fill("111111");
  await page.getByRole("button", { name: referralCopy.referral.consultation.confirmOneVisit }).click();
  await expect(page.getByText("That code is not right. 4 tries left.")).toBeVisible();
  expect(requests).toHaveLength(0);

  await page.getByLabel(siteCopy.numberCode.label).fill(NUMBER_CODE);
  await page.getByRole("button", { name: referralCopy.referral.consultation.confirmOneVisit }).click();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(verified).toEqual([
    { code_id: NUMBER_CODE_ID, code: "111111" },
    { code_id: NUMBER_CODE_ID, code: NUMBER_CODE },
  ]);
  expect(requests).toHaveLength(1);
});

/** Books the one visit on /book with the code typed. */
async function bookOneVisitWithCode(page: Page, code: string): Promise<void> {
  await openForm(page);
  await page
    .getByRole("group", { name: referralCopy.referral.consultation.plan.legend })
    .getByRole("radio", { name: "Consultation and fit · three hours" })
    .check();
  await toAddress(page);
  await page.getByLabel(referralCopy.referral.consultation.code.label).fill(code);
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submitOneVisit }).click();
  await enterNumberCode(page, "Confirm and book");
}

// A discount code for the one visit, on /book only (docs/decisions/0108-discount-codes.md), which no board draws.
// A refused code was said by the button, far below its box, and one that applied was never said.
test("says a wrong code under its box, and what a right one takes off once booked", async ({ page }) => {
  let applies = false;
  const requests = await mockApi(page);
  await page.route("**/api/consultation", (route) => {
    requests.push(route.request());
    if (applies) {
      const standing = { code: "WEDDNG25", kind: "amount", value: 100_000, cap: null };
      return route.fulfill({ status: 201, json: { ...BOOKED, one_visit: true, discount_code: standing } });
    }
    const refused = { error: { code: "code_not_applicable", request_id: "test", fields: ["discount_code"] } };
    return route.fulfill({ status: 422, json: refused });
  });
  await bookOneVisitWithCode(page, "wrong1");
  const box = page.getByLabel(referralCopy.referral.consultation.code.label);
  const refusal = "That discount code doesn’t apply. Check it, or leave it out to book without it.";
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleDescription(/^That discount code doesn’t apply\./);
  await expect(page.getByText(refusal)).toHaveCount(1);
  expect(await axeViolations(page)).toEqual([]);

  applies = true;
  await box.fill(" WEDDNG25 ");
  await page.getByRole("button", { name: referralCopy.referral.consultation.submitOneVisit }).click();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  await expect(page.getByText("Code WEDDNG25: Rs. 1,000 off, taken when you pay.")).toBeVisible();
  const sent = requests.at(-1)?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ one_visit: true, discount_code: "WEDDNG25" });
});

test("asks for a discount code only for the one visit", async ({ page }) => {
  await mockApi(page);
  await openForm(page);
  await toAddress(page);
  await expect(page.getByLabel(referralCopy.referral.consultation.code.label)).toHaveCount(0);
});

// Another booking may take a code's last use between its check and the hold, and the booking stands without it.
test("says when the code sent could not be applied, and that the booking stands without it", async ({ page }) => {
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true, discount_code: null } } });
  await bookOneVisitWithCode(page, "weddng25");
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  await expect(page.getByText("We couldn’t apply code WEDDNG25. Your booking stands without it.")).toBeVisible();
});

test("says what a percentage code takes off, up to its cap", async ({ page }) => {
  const standing = { code: "TENPC", kind: "percent", value: 10, cap: 200_000 };
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true, discount_code: standing } } });
  await bookOneVisitWithCode(page, "tenpc");
  await expect(page.getByText("Code TENPC: 10% off, up to Rs. 2,000, taken when you pay.")).toBeVisible();
});

test("offers the one visit the morning and the afternoon, never the evening, and the consultation all three", async ({
  page,
}) => {
  const requests = await mockApi(page);
  await openForm(page);
  const plan = page.getByRole("group", { name: referralCopy.referral.consultation.plan.legend });
  const windows = page.getByRole("group", { name: referralCopy.referral.consultation.window });
  await windows.getByRole("radio", { name: /Evening/ }).check();

  await plan.getByRole("radio", { name: "Consultation and fit · three hours" }).check();
  await expect(windows.getByRole("radio")).toHaveCount(2);
  await expect(windows.getByText("Evening")).toHaveCount(0);
  await expect(windows.getByRole("radio", { name: /Morning/ })).toBeChecked();

  await plan.getByRole("radio", { name: "Consultation · an hour", exact: true }).check();
  await expect(windows.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book a free consultation");

  await continueAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON() as Record<string, unknown>).not.toHaveProperty("one_visit");
});

// The full address before a slot is confirmed, on the site too (ADR 0081).
test("a booking without the address is stopped at the form, each part it needs marked", async ({ page }) => {
  const requests = await mockApi(page);
  await openForm(page);
  await toAddress(page);

  // The city is the pincode's to begin with, and the pincode is the one checked, not asked again.
  await expect(page.getByLabel(referralCopy.referral.address.labels.city)).toHaveValue(SERVED.city);
  await expect(page.getByText(SERVED.pincode, { exact: true })).toBeVisible();
  await page.getByLabel(referralCopy.referral.address.labels.city).fill("");
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();

  await expect(page.getByText(referralCopy.referral.address.errors.flat)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.address.errors.line1)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.address.errors.locality)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.address.errors.city)).toBeVisible();
  await expect(page.getByLabel(referralCopy.referral.address.labels.flat)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel(referralCopy.referral.address.labels.line1)).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel(referralCopy.referral.address.labels.line2)).not.toHaveAttribute("aria-invalid", "true");
  expect(requests).toHaveLength(0);

  await fillAddress(page);
  await page.getByLabel(referralCopy.referral.address.labels.city).fill("Gurugram");
  await page.getByLabel(referralCopy.referral.address.labels.accessNotes).fill("Gate 2, visitor parking");
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect((requests[0]?.postDataJSON() as Record<string, unknown>).address).toEqual({
    // Typed in full, with no building chosen from the search: it books without a pin.
    building: null,
    place_id: null,
    session_token: expect.any(String),
    flat: "Flat 402",
    floor: null,
    tower: null,
    line1: "Palm Grove Society",
    line2: null,
    landmark: null,
    locality: "Sector 65",
    city: "Gurugram",
    pincode: SERVED.pincode,
    access_notes: "Gate 2, visitor parking",
  });
});

// Whoever typed the number may not be its owner, so every number is answered alike. The details go to the
// number on WhatsApp, and the app opens with the number filled in.
test("every number is sent to WhatsApp, and offered the app with the number filled in", async ({ page }) => {
  await mockApi(page);
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: "Friday 25 September, 9 am to 12 pm" })).toBeVisible();
  await expect(
    page.getByText("Your technician arrives in that window. Details are on WhatsApp at +91 98100 00000."),
  ).toBeVisible();
  const app = page.getByRole("link", { name: referralCopy.referral.booked.app });
  // The link carries no number until it is followed, so no tag that reads the page's links sees it.
  await expect(app).toHaveAttribute("href", "http://app.localhost:4322");
  await page.route(/^http:\/\/app\.localhost:4322\//, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>App</title>" }),
  );
  await app.click();
  await expect(page).toHaveURL("http://app.localhost:4322/#mobile=9810000000");
});

// Nobody invited them, so nothing on this page may speak of an invite or of the
// three visits that come with one.
test("says nothing about an invite to someone who came here directly", async ({ page }) => {
  await mockApi(page);
  const invited = [/invited you/i, /3 visits/i, /3 service visits/i, /invite/i];

  await openForm(page);
  // The page is headed and introduced once: the form beneath it repeats neither.
  await expect(page.getByRole("heading", { name: "Book a free consultation" })).toHaveCount(1);
  await expect(page.getByText(/^Your technician measures your scalp and matches your colour/)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.consultation.body)).toHaveCount(0);
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);

  await openWaitlist(page);
  await expect(page.getByRole("button", { name: referralCopy.referral.waitlist.submit })).toBeVisible();
  // Where we do not come yet, the page no longer offers to book.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteCopy.booking.titleWaitlist);
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);
});

test("a pincode we do not serve lists the number kept, with the launch alert offered", async ({ page }) => {
  const requests = await mockApi(page);
  await openWaitlist(page);
  await expect(page.getByText("We are not in Bandra yet")).toBeVisible();
  await expect(page.getByText("Step 3 of 3 · The list")).toBeVisible();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name, { exact: true })).toHaveCount(0);

  await page.getByText("You may contact me about this request.").click();
  await page.getByText(referralCopy.referral.waitlist.launchAlert).click();
  await page.getByRole("button", { name: referralCopy.referral.waitlist.submit }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({
    name: "Test Visitor",
    mobile: "9810000000",
    contact_consent: true,
    launch_alert: true,
  });
});

// The lead is the conversion paid campaigns are bought for, whichever answer the pincode gave.
test("a booking and a waitlist are both counted, with nothing personal", async ({ page }) => {
  await mockApi(page);
  await openForm(page);
  await toAddress(page);
  await fillAddress(page);
  await page.getByRole("radio", { name: "Receding front", exact: true }).check();
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "book", served: true, area: "Sector 65", window: "morning", loss_extent: "receding" }],
    ["booking_confirmed", { page: "book", area: "Sector 65", window: "morning", state: "booked" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000", "Flat 402", "Palm Grove Society"]);

  await openWaitlist(page);
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: referralCopy.referral.waitlist.submit }).click();
  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "book", served: false, area: "Bandra", window: null, loss_extent: null }],
    ["waitlist_submitted", { page: "book", area: "Bandra" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000"]);
});

// A friend who opened an invite, left, and booked here later: the invite came with the booking, and the confirmation
// says what the landing's does (ADR 0089).
test("a friend who opened an invite books here with it, and is told the invite's visits land when fitted", async ({
  page,
}) => {
  const requests = await mockApi(page, {
    consultation: { status: 201, body: { ...BOOKED, credits: true, invite: "valid" } },
  });
  await openInvite(page);
  expect(JSON.parse((await remembered(page)) ?? "{}")).toMatchObject({ code: CODE });

  await visit(page, "/book");
  // The page itself still shows no card and no invite.
  await expect(page.getByText("sent you this")).toBeHidden();
  await expect(page.locator("img[width='1200']")).toHaveCount(0);
  await openForm(page);
  await toAddress(page);
  // The form says who is told of the fit before it sends the invite.
  await expect(page.getByText(TOLD)).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.remembered.bookWithout })).toBeVisible();
  await fillAndBook(page);

  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ invite_code: CODE, invite_told: true });
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  // Used, it is forgotten: a second booking from this browser carries nothing.
  expect(await remembered(page)).toBeNull();
});

// A friend who would rather their referrer were not told books without the invite.
test("a friend who opened an invite may book here without it, and the browser forgets it", async ({ page }) => {
  const requests = await mockApi(page);
  await openInvite(page);
  await openForm(page);
  await toAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.remembered.bookWithout }).click();

  await expect(page.getByText(TOLD)).toBeHidden();
  expect(await remembered(page)).toBeNull();
  await fillAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON()).not.toHaveProperty("invite_code");
  expect(requests[0]?.postDataJSON()).not.toHaveProperty("invite_told");
});

test("a friend who opened an invite joins a waitlist here with it, and is told the invite holds", async ({ page }) => {
  const requests = await mockApi(page, {
    waitlist: { status: 201, body: { area: UNSERVED.area, credits: true, invite: "valid" } },
  });
  await openInvite(page);
  await openWaitlist(page);
  await expect(
    page.getByText(
      "You have an invite. It stays valid for 12 months after we launch there. Whoever invited you is told when you are fitted.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.remembered.joinWithout })).toBeVisible();
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: referralCopy.referral.waitlist.submit }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ invite_code: CODE, invite_told: true });
  await expect(page.getByText(/The invite holds for 12 months from when we start coming to 400050\./)).toBeVisible();
  // Nobody who left "Tell me when you launch" unticked is promised a message they will never get.
  await expect(page.getByText(/We’ll message you on WhatsApp/)).toHaveCount(0);
  expect(await remembered(page)).toBeNull();
});

test("an invite opened more than 30 days ago, or one we do not know, is not sent", async ({ page }) => {
  const requests = await mockApi(page);
  await page.route(`**/api/r/ZZ9999`, (route) =>
    route.fulfill({
      json: {
        state: "unknown",
        referrer_first_name: null,
        partner: null,
        friend_visits: null,
        discount: null,
        card: { state: "house", version: 1 },
      },
    }),
  );
  await visit(page, "/r/ZZ9999");
  await expect(page.getByText("We do not recognise this invite")).toBeVisible();
  expect(await remembered(page)).toBeNull();

  const opened = new Date(Date.now() - 31 * 86_400_000).toISOString();
  await page.evaluate((savedAt) => {
    localStorage.setItem("mm_invite", JSON.stringify({ code: "RM4K7P", saved_at: savedAt }));
  }, opened);
  await bookHere(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON()).not.toHaveProperty("invite_code");
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
  // Past its thirty days it is not kept either, as the privacy page says.
  expect(await remembered(page)).toBeNull();
});

// A browser can refuse storage outright (private windows, a setting, a policy): both pages still book.
test("a browser that blocks storage books on the invite's page and here, and sends no remembered invite", async ({
  page,
}) => {
  const requests = await mockApi(page);
  await page.route(`**/api/r/${CODE}/consultation`, (route) => {
    requests.push(route.request());
    const { discount_code: _none, ...booked } = BOOKED;
    return route.fulfill({ status: 201, json: { ...booked, credits: true, invite: "valid" } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });

  await openInvite(page);
  // The invite's page asks for everything in one form, the name and number with it.
  await checkPincode(page, SERVED.pincode);
  await fillAddress(page);
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000000");
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  expect(new URL(requests[0]?.url() ?? "").pathname).toBe(`/api/r/${CODE}/consultation`);

  await bookHere(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(new URL(requests[1]?.url() ?? "").pathname).toBe("/api/consultation");
  expect(requests[1]?.postDataJSON()).not.toHaveProperty("invite_code");
});

// While self-serve booking is off the page asks rather than books, and the day
// asked for waits for ops (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
test("booking through WhatsApp for now is confirmed as a request, not refused", async ({ page }) => {
  await mockApi(page, {
    consultation: {
      status: 201,
      body: { ...BOOKED, state: "requested" },
    },
  });
  await bookHere(page);

  await expect(page.getByText(referralCopy.referral.requested.label)).toBeVisible();
  await expect(page.getByText("On WhatsApp, at +91 98100 00000, to fix the hour.")).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.consultation.submit })).toBeHidden();
});

// An empty submit left focus on the button, with the first errors two or three screens above it.
test("an empty first step marks the name, the number and the agreement, focuses the name, and keeps nothing", async ({
  page,
}) => {
  await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(referralCopy.referral.form.nameError)).toBeVisible();
  await expect(page.getByText(siteCopy.tryOn.gate.mobileError)).toBeVisible();
  await expect(page.getByText("We need this to contact you.")).toBeVisible();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toBeFocused();
  await expect(page.getByText("Check the 3 fields marked above.")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  expect(leads).toHaveLength(0);
});

test("an empty address shows each error, announced, brings the first into view, and sends nothing", async ({
  page,
}) => {
  const requests = await mockApi(page);
  await openForm(page);
  await toAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();

  await expect(page.getByText(referralCopy.referral.address.errors.line1)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.address.errors.locality)).toBeVisible();
  const flat = page.getByLabel(referralCopy.referral.address.labels.flat);
  await expect(flat).toBeFocused();
  await expect(flat).toBeInViewport();
  // The city is the pincode's, so three parts of the address are marked.
  await expect(page.getByText("Check the 3 fields marked above.")).toBeVisible();
  expect(requests).toHaveLength(0);
});

// A number starting with 5 passed the form, and the API's refusal read "Something went wrong at our end".
test("a number that is not a mobile is marked at its field, focused, and not sent", async ({ page }) => {
  await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("5876543210");
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const mobile = page.getByLabel(siteCopy.tryOn.gate.mobile);
  await expect(mobile).toHaveAttribute("aria-invalid", "true");
  await expect(mobile).toHaveAccessibleDescription("Enter a valid 10-digit mobile number.");
  await expect(mobile).toBeFocused();
  await expect(page.getByText(/fields marked above/)).toHaveCount(0);
  expect(leads).toHaveLength(0);
});

// Our WhatsApp messages greet people by this name, so a link typed as one is never sent.
test("a name that is not letters is marked at its field, focused, and not sent", async ({ page }) => {
  await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Win at example.com");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000000");
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const name = page.getByLabel(siteCopy.tryOn.gate.name);
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription("Enter your name in letters.");
  await expect(name).toBeFocused();
  expect(leads).toHaveLength(0);
});

// A refusal naming fields was said by the button as our fault, with nothing marked.
test("the fields the API refuses are marked where they are, the first focused, and not blamed on us", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("**/api/lead", (route) =>
    route.fulfill({ status: 400, json: { error: { code: "invalid_request", request_id: "r", fields: ["mobile"] } } }),
  );
  await visit(page, "/book");
  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000000");
  await page.getByText(CONSULTATION_CONSENT).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const mobile = page.getByLabel(siteCopy.tryOn.gate.mobile);
  await expect(mobile).toHaveAttribute("aria-invalid", "true");
  await expect(mobile).toHaveAccessibleDescription("Enter a valid 10-digit mobile number.");
  await expect(mobile).toBeFocused();
  await expect(page.getByLabel("Pincode")).toHaveCount(0);
  await expect(page.getByText(/at our end/)).toHaveCount(0);
  await mobile.fill("9810000001");
  await expect(mobile).toHaveAttribute("aria-invalid", "false");
});

test("the address the API refuses is marked where it is, focused, and not blamed on us", async ({ page }) => {
  const refused = { error: { code: "invalid_request", request_id: "r", fields: ["address.flat"] } };
  const requests = await mockApi(page, { consultation: { status: 400, body: refused } });
  await bookHere(page);

  const flat = page.getByLabel(referralCopy.referral.address.labels.flat);
  await expect(flat).toHaveAttribute("aria-invalid", "true");
  await expect(flat).toBeFocused();
  await expect(flat).toBeInViewport();
  await expect(page.getByText(/at our end/)).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test("an empty waitlist submit marks the agreement, and sends nothing", async ({ page }) => {
  const requests = await mockApi(page);
  await openWaitlist(page);
  await page.getByRole("button", { name: referralCopy.referral.waitlist.submit }).click();

  await expect(page.getByText("We need this to contact you.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /You may contact me about this request\./ })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(requests).toHaveLength(0);
});

// Every day and window was drawn open, so a full one failed only after the whole form was filled in. The
// strip's first two days are Saturday 3 and Sunday 4 October.
test("draws full days and windows closed, and starts on the first open one", async ({ page }) => {
  await page.clock.setFixedTime(NOON_2_OCTOBER);
  const requests = await mockApi(page);
  const asked = await answerOpen(page, () =>
    openDays({ "2026-10-03": FULL, "2026-10-04": { morning: false, afternoon: true, evening: true } }),
  );
  await openForm(page);

  const days = page.getByRole("group", { name: referralCopy.referral.consultation.date }).getByRole("radio");
  await expect(days.nth(0)).toBeDisabled();
  await expect(days.nth(1)).toBeChecked();
  const windows = page.getByRole("group", { name: referralCopy.referral.consultation.window });
  await expect(windows.getByRole("radio", { name: /^Morning/ })).toBeDisabled();
  await expect(windows.getByText(referralCopy.referral.consultation.full, { exact: true })).toBeVisible();
  await expect(windows.getByRole("radio", { name: /^Afternoon/ })).toBeChecked();
  expect(asked[0]?.searchParams.toString()).toBe("pincode=122018&plan=consultation");
  expect(await axeViolations(page)).toEqual([]);

  await continueAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ date: "2026-10-04", window: "afternoon" });
});

test("asks again for one visit, whose three hours may not fit where a consultation does", async ({ page }) => {
  await page.clock.setFixedTime(NOON_2_OCTOBER);
  await mockApi(page);
  const asked = await answerOpen(page, (plan) =>
    plan === "one_visit" ? openDays({ "2026-10-03": FULL }) : openDays(),
  );
  await openForm(page);
  const days = page.getByRole("group", { name: referralCopy.referral.consultation.date }).getByRole("radio");
  await expect(days.nth(0)).toBeChecked();

  await page
    .getByRole("group", { name: referralCopy.referral.consultation.plan.legend })
    .getByRole("radio", { name: "Consultation and fit · three hours" })
    .check();

  await expect(days.nth(0)).toBeDisabled();
  await expect(days.nth(1)).toBeChecked();
  expect(asked.map((url) => url.searchParams.get("plan"))).toEqual(["consultation", "one_visit"]);
});

// The window goes between the visit and the address; the visitor is taken back to pick another.
test("a window found full on booking says so back at the visit, and the strip is drawn afresh", async ({ page }) => {
  await page.clock.setFixedTime(NOON_2_OCTOBER);
  await mockApi(page, { consultation: { status: 409, body: { error: { code: "taken", request_id: "r" } } } });
  let calls = 0;
  await answerOpen(page, () => {
    calls += 1;
    return calls === 1 ? openDays() : openDays({ "2026-10-03": { morning: false, afternoon: true, evening: true } });
  });
  await openForm(page);
  const windows = page.getByRole("group", { name: referralCopy.referral.consultation.window });
  await expect(windows.getByRole("radio", { name: /^Morning/ })).toBeChecked();

  await continueAndBook(page);

  await expect(page.getByText(referralCopy.referral.errors.taken)).toBeVisible();
  await expect(windows.getByRole("radio", { name: /^Morning/ })).toBeDisabled();
  await expect(windows.getByRole("radio", { name: /^Afternoon/ })).toBeChecked();
  expect(calls).toBe(2);

  // On again, the address typed is still there, and what was said of the window is not.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel(referralCopy.referral.address.labels.flat)).toHaveValue("Flat 402");
  await expect(page.getByText(referralCopy.referral.errors.taken)).toHaveCount(0);
});

test("a fortnight with nothing open says so, and offers WhatsApp", async ({ page }) => {
  await page.clock.setFixedTime(NOON_2_OCTOBER);
  await mockApi(page);
  await answerOpen(page, () => openDays({}, FULL));
  await openForm(page);

  await expect(page.getByText(referralCopy.referral.consultation.noneOpen)).toBeVisible();
  await expect(page.getByRole("link", { name: referralCopy.referral.consultation.noneOpenAction })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/91\d{10}$/,
  );
  const days = page.getByRole("group", { name: referralCopy.referral.consultation.date }).getByRole("radio");
  await expect(days).toHaveCount(14);
  await expect(
    page.getByRole("group", { name: referralCopy.referral.consultation.date }).getByRole("radio", { disabled: false }),
  ).toHaveCount(0);
  // There is no visit to go on from.
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

// Back after the pincode's answer, or after the confirmation, left /book and lost everything typed.
test("Back steps back through the page, and Forward returns to the confirmation", async ({ page }) => {
  await mockApi(page);
  await openForm(page);
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeVisible();

  await page.goBack();
  expect(new URL(page.url()).pathname).toMatch(/^\/book\/?$/);
  await expect(page.getByLabel("Pincode")).toHaveValue(SERVED.pincode);
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await page.goBack();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  await page.goForward();
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeFocused();

  await page
    .getByRole("group", { name: referralCopy.referral.consultation.window })
    .getByRole("radio", { name: /Afternoon/ })
    .check();
  await toAddress(page);
  await page.goBack();
  await expect(
    page
      .getByRole("group", { name: referralCopy.referral.consultation.window })
      .getByRole("radio", { name: /^Afternoon/ }),
  ).toBeChecked();
  await page.goForward();
  await fillAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.consultation.submit })).toBeVisible();
  await page.goForward();
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
});

// Fourteen tiles read "Sat 31 … Fri 6" with no month, and a screen reader heard "Sat 31".
test("the date strip names its months, and each day in full to a screen reader", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-23T06:00:00Z"));
  await mockApi(page);
  await openForm(page);

  const dates = page.getByRole("group", { name: referralCopy.referral.consultation.date });
  await expect(dates.getByText("October – November")).toBeVisible();
  const days = dates.getByRole("radio");
  await expect(days.first()).toHaveAccessibleName("Saturday 24 October");
  await expect(days.nth(7)).toHaveAccessibleName("Saturday 31 October");
  await expect(days.nth(8)).toHaveAccessibleName("Sunday 1 November");
});

// "Building, society or street" was followed by "Street (optional)", and every optional part
// stood open.
test("the address asks for the street once, and folds the floor, tower and landmark until asked", async ({ page }) => {
  const requests = await mockApi(page);
  await openForm(page);
  await toAddress(page);

  const address = page.getByRole("group", { name: siteCopy.booking.steps.address });
  await expect(address.getByLabel(referralCopy.referral.address.labels.line1)).toBeVisible();
  await expect(address.getByLabel(referralCopy.referral.address.labels.line2)).toBeVisible();
  for (const folded of ["Floor (optional)", "Tower or block (optional)", "Landmark (optional)"]) {
    await expect(address.getByLabel(folded)).toHaveCount(0);
  }
  await address.getByRole("button", { name: referralCopy.referral.address.more }).click();
  await expect(address.getByLabel(referralCopy.referral.address.labels.floor)).toBeFocused();
  await expect(address.getByRole("button", { name: referralCopy.referral.address.more })).toHaveCount(0);
  await address.getByLabel(referralCopy.referral.address.labels.tower).fill("Tower C");

  await fillAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect((requests[0]?.postDataJSON() as { address: Record<string, unknown> }).address).toMatchObject({
    tower: "Tower C",
    line1: "Palm Grove Society",
  });
});

// Everyone who skipped the question was recorded as crown thinning.
test("chooses nothing for the visitor where the hair loss is", async ({ page }) => {
  await mockApi(page);
  await openForm(page);
  await toAddress(page);
  const extent = page.getByRole("group", { name: siteCopy.booking.extent });
  await expect(extent.getByRole("radio")).toHaveCount(3);
  for (const choice of await extent.getByRole("radio").all()) await expect(choice).not.toBeChecked();
});

// An empty check blamed the input, and "Change the pincode" was a 58 x 20 px target.
test("an empty pincode is asked for, and Change is a full-size target", async ({ page }) => {
  await mockApi(page);
  await openAtPincode(page);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  await expect(page.getByText(referralCopy.referral.pincode.empty)).toBeVisible();

  await checkPincode(page, SERVED.pincode);
  const change = page.getByRole("button", { name: referralCopy.referral.pincode.changeLabel });
  const box = await change.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  await change.click();
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await expect(page.getByLabel("Pincode")).toHaveValue(SERVED.pincode);
});

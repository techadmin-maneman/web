// The site's own booking page against a mocked API, so every answer the API can give is covered
// (docs/decisions/0051-booking-from-the-site.md): the name and number first, the visit, the one visit and its
// codes. Invites and the waitlist are ./book-invites.e2e.ts, the refusals and the date strip ./book-errors.e2e.ts,
// the shared answers ./book-fixtures.ts; e2e/book-api.e2e.ts books against the real local API.

import type { Page } from "@playwright/test";
import { axeViolations } from "./a11y.ts";
import { fillAddress } from "./address-form.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";
import { enterNumberCode, expect, NUMBER_CODE, NUMBER_CODE_ID, test, visit } from "./support.ts";
import {
  SERVED,
  BOOKED,
  mockApi,
  CONSULTATION_CONSENT,
  leaveDetails,
  checkPincode,
  openAtPincode,
  openForm,
  toAddress,
  fillAndBook,
  continueAndBook,
  bookHere,
  leadCalls,
  AGREE_TERMS,
} from "./book-fixtures.ts";

test("the page introduces itself, with no invite and no card", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");

  await expect(page.getByRole("heading", { level: 1, name: siteCopy.booking.title })).toBeVisible();
  await expect(page.getByText("sent you this")).toBeHidden();
  await expect(page.getByText(referralCopy.referral.arrival.unknown.notice)).toBeHidden();
  await expect(page.locator("img[width='1200']")).toHaveCount(0);
});

// Each step's Turnstile widget started its challenge as the page loaded, before anyone had typed.
test("asks Cloudflare for nothing until the visitor starts on the form", async ({ page }) => {
  await mockApi(page);
  const challenges: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "challenges.cloudflare.com") challenges.push(request.url());
  });
  await visit(page, "/book");
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(challenges).toEqual([]);

  await page.getByLabel(siteCopy.tryOn.gate.name).fill("Test Visitor");
  await expect.poll(() => challenges.length).toBeGreaterThan(0);
});

// Twelve fields stood between the visitor and the button, the name and number last, so anyone who stopped halfway
// left nothing behind (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
test("keeps the name and number first, then asks for the area, the visit and the address, a step at a time", async ({
  page,
}) => {
  const requests = await mockApi(page);
  const leads = await leadCalls(page);
  await visit(page, "/book");

  await expect(page.getByText("Step 1 · About you")).toBeVisible();
  await expect(page.getByLabel(referralCopy.referral.pincode.label)).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await leaveDetails(page);

  expect(leads).toHaveLength(1);
  const lead = leads[0]?.postDataJSON() as Record<string, unknown>;
  expect(lead).toMatchObject({ name: "Test Visitor", mobile: "9810000000", consent: true });
  expect(lead.turnstile_token).toBeTruthy();
  await expect(page.getByText("For Test Visitor, +91 98100 00000")).toBeVisible();
  await expect(page.getByText("Step 2 · Your area")).toBeVisible();

  await checkPincode(page, SERVED.pincode);
  await expect(page.getByText("Step 3 · Your visit")).toBeVisible();
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
  await expect(page.getByText("Step 1 · About you")).toBeFocused();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveValue("98100 00000");
  await page.getByRole("button", { name: siteCopy.booking.start }).click();
  await expect(page.getByLabel(referralCopy.referral.pincode.label)).toBeFocused();
  expect(leads).toHaveLength(1);

  await page.getByRole("button", { name: siteCopy.booking.changeYouLabel }).click();
  await page.getByLabel(siteCopy.tryOn.gate.mobile).fill("9810000001");
  await page.getByRole("button", { name: siteCopy.booking.start }).click();
  await expect(page.getByText("For Test Visitor, +91 98100 00001")).toBeVisible();
  expect(leads).toHaveLength(2);
});

// A reload on any step after the first opened the name and number again, empty, with the history still past them.
test("a reload resumes the step it was on, the name and number kept, and Back still steps back", async ({ page }) => {
  await mockApi(page);
  const leads = await leadCalls(page);
  await openAtPincode(page);

  await page.reload();
  await expect(page.getByText("For Test Visitor, +91 98100 00000")).toBeVisible();
  await expect(page.getByLabel(referralCopy.referral.pincode.label)).toBeFocused();
  await checkPincode(page, SERVED.pincode);
  await expect(page.getByText("Step 3 · Your visit")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Step 3 · Your visit")).toBeVisible();
  await expect(page.getByText("For Test Visitor, +91 98100 00000")).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel(referralCopy.referral.pincode.label)).toBeFocused();
  await page.goBack();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  expect(leads).toHaveLength(1);

  await page.goForward();
  await page.goForward();
  await continueAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Step 1 · About you")).toBeVisible();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("");
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
  await expect(page.getByRole("checkbox", { name: CONSULTATION_CONSENT })).toBeChecked();
  await page.getByRole("checkbox", { name: AGREE_TERMS }).check();
  await page.getByRole("button", { name: siteCopy.booking.start }).click();
  await checkPincode(page, SERVED.pincode);
  await continueAndBook(page);

  await expect(
    page.getByText("Your technician arrives in those hours. Details are on WhatsApp at +91 98765 43210."),
  ).toBeVisible();
  expect(leads[0]?.postDataJSON()).toMatchObject({ mobile: "9876543210" });
  expect(requests[0]?.postDataJSON()).toMatchObject({ mobile: "9876543210" });
});

test("restates the day and window booked, says what the visit asks, and offers it to the calendar", async ({
  page,
}) => {
  await mockApi(page);
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: "Friday 25 September, 9 am–12 noon" })).toBeVisible();
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

test("restates a start booked as the window the technician arrives in", async ({ page }) => {
  const atHalfPast = { ...BOOKED, starts_at: "2026-09-25T04:00:00.000Z", arrives_by: "2026-09-25T04:30:00.000Z" };
  await mockApi(page, { consultation: { status: 201, body: atHalfPast } });
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: "Friday 25 September, 9:30–10 am" })).toBeVisible();
});

test("a request waiting for ops to fix the hour offers no calendar", async ({ page }) => {
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, state: "requested" } } });
  await bookHere(page);

  await expect(page.getByRole("heading", { level: 1, name: referralCopy.referral.requested.title })).toBeVisible();
  await expect(page.getByRole("link", { name: referralCopy.referral.booked.calendar.google })).toHaveCount(0);
});

// No form asks where the hair loss is: a specialist sees it at the visit.
test("a served pincode books, and asks nothing of where the hair loss is", async ({ page }) => {
  const requests = await mockApi(page);
  await openAtPincode(page);
  await checkPincode(page, SERVED.pincode);
  await expect(page.getByText("We come to Sector 65")).toBeVisible();

  await toAddress(page);
  await fillAddress(page);
  await expect(page.getByRole("radio", { name: "Receding front", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submit }).click();

  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "morning", consent: true });
  expect(sent).not.toHaveProperty("loss_extent");
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
  await plan.getByRole("radio", { name: "Consultation and fit · 3 hours" }).check();
  await expect(plan.getByRole("radio", { name: "Consultation and fit · 3 hours" })).toBeChecked();
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
    .getByRole("radio", { name: "Consultation and fit · 3 hours" })
    .check();
  await toAddress(page);
  await fillAddress(page);
  await page.getByRole("button", { name: referralCopy.referral.consultation.submitOneVisit }).click();

  await page.getByLabel(siteCopy.numberCode.label).fill("111111");
  await page.getByRole("button", { name: referralCopy.referral.consultation.confirmOneVisit }).click();
  await expect(page.getByText("That code didn’t match. 4 tries left.")).toBeVisible();
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
    .getByRole("radio", { name: "Consultation and fit · 3 hours" })
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
  await expect(page.getByText("Code WEDDNG25: Rs. 1,000 off, applied when you pay.")).toBeVisible();
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
  await expect(page.getByText("Code TENPC: 10% off, up to Rs. 2,000, applied when you pay.")).toBeVisible();
});

test("offers the one visit the morning and the afternoon, never the evening, and the consultation all three", async ({
  page,
}) => {
  const requests = await mockApi(page);
  await openForm(page);
  const plan = page.getByRole("group", { name: referralCopy.referral.consultation.plan.legend });
  const windows = page.getByRole("group", { name: referralCopy.referral.consultation.window });
  await windows.getByRole("radio", { name: /Evening/ }).check();

  await plan.getByRole("radio", { name: "Consultation and fit · 3 hours" }).check();
  await expect(windows.getByRole("radio")).toHaveCount(2);
  await expect(windows.getByText("Evening")).toHaveCount(0);
  await expect(windows.getByRole("radio", { name: /Morning/ })).toBeChecked();

  await plan.getByRole("radio", { name: "Consultation · 60 minutes", exact: true }).check();
  await expect(windows.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteCopy.booking.title);

  await continueAndBook(page);
  await expect(page.getByText(referralCopy.referral.booked.label, { exact: true })).toBeVisible();
  expect(requests[0]?.postDataJSON() as Record<string, unknown>).not.toHaveProperty("one_visit");
});

// Someone who gave their name and number at the try-on was asked for them again, and a booking left them to sign in
// to the app with another code (ADR 0214).
test("starts from the try-on's name and number, and a booking for the number it proved goes on into the app signed in", async ({
  page,
}) => {
  const challenge = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c";
  await page.addInitScript(() => {
    const visitor = { name: "Test Visitor", mobile: "9810000000", proof: "5a1e0000-0000-4000-8000-00000000c0de" };
    sessionStorage.setItem("mm_visitor", JSON.stringify(visitor));
  });
  await mockApi(page);
  const handedOver: unknown[] = [];
  await page.route("**/api/number-code/sign-in", (route) => {
    handedOver.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { challenge_id: challenge, code: "123456" } });
  });
  await visit(page, "/book");
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveValue("98100 00000");
  await page.getByRole("checkbox", { name: AGREE_TERMS }).check();

  await page.getByRole("button", { name: siteCopy.booking.start }).click();
  await checkPincode(page, SERVED.pincode);
  const leaving = page.waitForRequest((request) => request.isNavigationRequest() && request.url().includes("app."));
  await continueAndBook(page);
  expect(new URL((await leaving).url()).origin).toMatch(/^http:\/\/app\.localhost:\d+$/);
  expect(handedOver).toEqual([{ code_id: "5a1e0000-0000-4000-8000-00000000c0de", mobile: "9810000000" }]);
});

// On staging the fields stayed empty: hydrating keeps the server's empty fields, and only the referral reward's answer
// drawing the form again put the remembered name in them here. Held, it draws nothing.
test("shows the try-on's name and number in its fields as soon as the page is drawn", async ({ page }) => {
  await page.route("**/api/referral-reward", () => undefined);
  await page.addInitScript(() => {
    const visitor = { name: "Test Visitor", mobile: "9810000000", proof: "5a1e0000-0000-4000-8000-00000000c0de" };
    sessionStorage.setItem("mm_visitor", JSON.stringify(visitor));
  });
  await visit(page, "/book");
  await expect(page.getByLabel(siteCopy.tryOn.gate.name)).toHaveValue("Test Visitor");
  await expect(page.getByLabel(siteCopy.tryOn.gate.mobile)).toHaveValue("98100 00000");
});

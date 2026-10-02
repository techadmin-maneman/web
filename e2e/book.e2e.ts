// The site's own booking page against a mocked API, so every answer the API can
// give is covered (docs/decisions/0051-booking-from-the-site.md). It is the
// referral landing without the invite: e2e/refer-landing.e2e.ts covers that one,
// and e2e/book-api.e2e.ts books against the real local API. It books with an
// invite only when this browser remembers one (docs/decisions/0089-an-invite-is-not-lost.md).

import AxeBuilder from "@axe-core/playwright";
import type { Page, Request } from "@playwright/test";
import { fillAddress } from "./booking-area.ts";
import { analyticsEvents, expect, expectNoPersonalData, fakeTurnstile, test, visit } from "./support.ts";

const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };
const UNSERVED = { pincode: "400050", served: false, area: "Bandra", city: "Mumbai" };

const BOOKED = {
  state: "booked",
  date: "2026-09-25",
  window: "morning",
  area: SERVED.area,
  credits: false,
  invite: "unknown",
  address: "saved",
  one_visit: false,
  discount_code: null,
};

const CODE = "RM4K7P";
const INVITE = { state: "valid", referrer_first_name: "Rohit", card: { state: "house", version: 1 } };

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

async function bookHere(page: Page): Promise<void> {
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
}

test("the page introduces itself, with no invite and no card", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");

  await expect(page.getByRole("heading", { level: 1, name: "Book a free consultation" })).toBeVisible();
  await expect(page.getByText("sent you this")).toBeHidden();
  await expect(page.getByText("We do not recognise this invite")).toBeHidden();
  await expect(page.locator("img[width='1200']")).toHaveCount(0);
});

// The field kept the first ten digits, so "+91 98765 43210" was booked as 91987 65432, someone else's number.
test("a number with +91, 91, 0 or 0091 in front books its own ten digits, pasted or typed", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");

  const mobile = page.getByLabel("Mobile");
  for (const typed of ["+91 98765 43210", "+919876543210", "919876543210", "09876543210", "0091 98765 43210"]) {
    await mobile.fill(typed);
    await expect(mobile).toHaveValue("98765 43210");
    await mobile.clear();
    await mobile.pressSequentially(typed);
    await expect(mobile).toHaveValue("98765 43210");
  }
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ mobile: "9876543210" });
});

test("a served pincode books, and sends where the hair loss is", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("We come to Sector 65")).toBeVisible();

  await fillAddress(page);
  await page.getByText("Receding front", { exact: true }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ pincode: SERVED.pincode, window: "morning", consent: true, loss_extent: "receding" });
  expect(sent.turnstile_token).toBeTruthy();
  // The consultation alone, as the form starts (ADR 0105).
  expect(sent).not.toHaveProperty("one_visit");
  await expect(page.getByText(/Your technician brings the range/)).toBeHidden();
  // The invite's three visits are the landing's; this page promises nothing of the kind.
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeHidden();
});

// The owner's ruling D2 of 1 October 2026 (ADR 0025, item 89; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the client chooses one visit or two. The second choice books the consultation and fit in one visit, three hours,
// paid for once fitted; it replaces the consultation with the first fit to follow, whose tests went with it.
test("offers the consultation and fit in one visit, and says what it holds and how it is paid", async ({ page }) => {
  const requests = await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true } } });
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();

  const plan = page.getByRole("group", { name: "What to book" });
  await expect(plan.getByRole("radio")).toHaveCount(2);
  await plan.getByText("Consultation and fit · three hours").click();
  await expect(plan.getByRole("radio", { name: "Consultation and fit · three hours" })).toBeChecked();
  await expect(page.getByText(/^Starts in the morning or the afternoon\./)).toBeVisible();
  // CP-20: the page's heading follows what it books.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book a consultation and fit");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation and fit" }).click();

  await expect(page.getByText("Consultation and fit booked")).toBeVisible();
  const sent = requests[0]?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ one_visit: true, window: "morning", consent: true });
  // Where the hair loss is was skipped, so nothing is said of it (BK-60).
  expect(sent).not.toHaveProperty("loss_extent");
  await expect(
    page.getByText(
      "Your technician brings the range for you to choose from. Once you are fitted, you pay by a link sent to your phone.",
    ),
  ).toBeVisible();
  // Nothing is paid on the site, and nothing for the fit until it is done.
  await expect(page.getByText(/· pay once fitted$/)).toBeVisible();
  await expect(page.getByText(/· free$/)).toHaveCount(0);
});

/** Books the one visit on /book with the code typed. */
async function bookOneVisitWithCode(page: Page, code: string): Promise<void> {
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByLabel("Discount code (optional)")).toHaveCount(0);
  await page.getByRole("group", { name: "What to book" }).getByText("Consultation and fit · three hours").click();
  await page.getByLabel("Discount code (optional)").fill(code);
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation and fit" }).click();
}

// A discount code for the one visit, on /book only (docs/decisions/0108-discount-codes.md), which no board draws.
// MON-22 and CP-23: a refused code was said by the button, far below its box, and one that applied was never said.
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
  const box = page.getByLabel("Discount code (optional)");
  const refusal = "That discount code does not apply. Check it, or leave it out to book without it.";
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(box).toBeFocused();
  await expect(box).toHaveAccessibleDescription(/^That discount code does not apply\./);
  await expect(page.getByText(refusal)).toHaveCount(1);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  applies = true;
  await box.fill(" WEDDNG25 ");
  await page.getByRole("button", { name: "Book the consultation and fit" }).click();
  await expect(page.getByText("Consultation and fit booked")).toBeVisible();
  await expect(page.getByText("Code WEDDNG25: Rs. 1,000 off, taken when you pay.")).toBeVisible();
  const sent = requests.at(-1)?.postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ one_visit: true, discount_code: "WEDDNG25" });
});

// CP-23: another booking may take a code's last use between its check and the hold, and the booking stands without it.
test("says when the code sent could not be applied, and that the booking stands without it", async ({ page }) => {
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, one_visit: true, discount_code: null } } });
  await bookOneVisitWithCode(page, "weddng25");
  await expect(page.getByText("Consultation and fit booked")).toBeVisible();
  await expect(page.getByText("We could not apply code WEDDNG25. Your booking stands without it.")).toBeVisible();
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
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  const plan = page.getByRole("group", { name: "What to book" });
  const windows = page.getByRole("group", { name: "Window" });
  await windows.getByText("Evening").click();

  await plan.getByText("Consultation and fit · three hours").click();
  await expect(windows.getByRole("radio")).toHaveCount(2);
  await expect(windows.getByText("Evening")).toHaveCount(0);
  await expect(windows.getByRole("radio", { name: /Morning/ })).toBeChecked();

  await plan.getByText("Consultation · an hour", { exact: true }).click();
  await expect(windows.getByRole("radio")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book a free consultation");

  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect(requests[0]?.postDataJSON() as Record<string, unknown>).not.toHaveProperty("one_visit");
});

// The owner's ruling of 27 September 2026: the full address before a slot is confirmed, on the site too (ADR 0081).
test("a booking without the address is stopped at the form, each part it needs marked", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();

  // The city is the pincode's to begin with, and the pincode is the one checked, not asked again.
  await expect(page.getByLabel("City")).toHaveValue(SERVED.city);
  await expect(page.getByText(SERVED.pincode, { exact: true })).toBeVisible();
  await page.getByLabel("City").fill("");
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Please give the flat or house number.")).toBeVisible();
  await expect(page.getByText("Please give the building or society.")).toBeVisible();
  await expect(page.getByText("Please give the sector or area.")).toBeVisible();
  await expect(page.getByText("Please give the city.")).toBeVisible();
  await expect(page.getByLabel("Flat or house number")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Building or society")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Street (optional)")).toHaveAttribute("aria-invalid", "false");
  expect(requests).toHaveLength(0);

  await fillAddress(page);
  await page.getByLabel("City").fill("Gurugram");
  await page.getByLabel("Access notes (optional)").fill("Gate 2, visitor parking");
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect((requests[0]?.postDataJSON() as Record<string, unknown>).address).toEqual({
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

// The form needs no login, so a number that already has an address keeps it, and the page says so without
// naming any part of it (ADR 0081).
test("a number with an address already is told the visit goes there, and shown nothing of it", async ({ page }) => {
  await mockApi(page, { consultation: { status: 201, body: { ...BOOKED, address: "on_account" } } });
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText("We come to the address already on your account, not the one given here.")).toBeVisible();
  // CP-21: the card printed the area typed while the visit went to the account's address.
  await expect(page.getByText("At the address on your account · free")).toBeVisible();
  await expect(page.getByText(/Sector 65, Gurgaon/)).toHaveCount(0);
});

test("a booking that saved the address given says nothing about an account", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();

  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText(/already on your account/)).toHaveCount(0);
  await expect(page.getByText("Sector 65, Gurgaon 122018 · free")).toBeVisible();
});

// Nobody invited them, so nothing on this page may speak of an invite or of the
// three visits that come with one.
test("says nothing about an invite to someone who came here directly", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  const invited = [/invited you/i, /3 visits/i, /3 service visits/i, /invite/i];

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  // CP-20: the page is headed and introduced once: the form beneath it repeats neither.
  await expect(page.getByRole("heading", { name: "Book a free consultation" })).toHaveCount(1);
  await expect(page.getByText(/^Your technician measures your scalp and matches your colour/)).toBeVisible();
  await expect(page.getByText("An hour, and free. Or have your fit in the same visit.")).toHaveCount(0);
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);

  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("button", { name: "Add me to the list" })).toBeVisible();
  // CP-20: where we do not come yet, the page no longer offers to book.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not in your area yet");
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

// CLI-02: the same number booking again is not a second consultation; the page says which day it already has.
test("a number that already has a consultation is told its day, and counted as no new lead", async ({ page }) => {
  await mockApi(page, {
    consultation: {
      status: 409,
      body: { error: { code: "already_booked", request_id: "r" }, booked: { date: "2026-09-26", window: "morning" } },
    },
  });
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText(/already has a consultation, Saturday 26 Sep, 9\sam to 12\spm\./)).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([]);
});

// FEO-17: the lead is the conversion paid campaigns are bought for, whichever answer the pincode gave.
test("a booking and a waitlist are both counted, with nothing personal", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
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
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000", "Flat 402", "Palm Grove Society"]);

  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();
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
  await bookHere(page);

  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ invite_code: CODE });
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  // Used, it is forgotten: a second booking from this browser carries nothing.
  expect(await remembered(page)).toBeNull();
});

test("a friend who opened an invite joins a waitlist here with it, and is told the invite holds", async ({ page }) => {
  const requests = await mockApi(page, {
    waitlist: { status: 201, body: { area: UNSERVED.area, credits: true, invite: "valid" } },
  });
  await openInvite(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(UNSERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me about this request.").click();
  await page.getByRole("button", { name: "Add me to the list" }).click();

  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(requests[0]?.postDataJSON()).toMatchObject({ invite_code: CODE });
  await expect(page.getByText(/The invite holds for 12 months after that\./)).toBeVisible();
  expect(await remembered(page)).toBeNull();
});

test("an invite opened more than 30 days ago, or one we do not know, is not sent", async ({ page }) => {
  const requests = await mockApi(page);
  await page.route(`**/api/r/ZZ9999`, (route) =>
    route.fulfill({ json: { state: "unknown", referrer_first_name: null, card: { state: "house", version: 1 } } }),
  );
  await visit(page, "/r/ZZ9999");
  await expect(page.getByText("We do not recognise this invite")).toBeVisible();
  expect(await remembered(page)).toBeNull();

  const opened = new Date(Date.now() - 31 * 86_400_000).toISOString();
  await page.evaluate((savedAt) => {
    localStorage.setItem("mm_invite", JSON.stringify({ code: "RM4K7P", saved_at: savedAt }));
  }, opened);
  await bookHere(page);
  await expect(page.getByText("Consultation booked")).toBeVisible();
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
    return route.fulfill({ status: 201, json: { ...BOOKED, credits: true, invite: "valid" } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });

  await openInvite(page);
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
  await expect(page.getByText("Consultation booked")).toBeVisible();
  await expect(page.getByText("The 3 service visits land when you are fitted.")).toBeVisible();
  expect(new URL(requests[0]?.url() ?? "").pathname).toBe(`/api/r/${CODE}/consultation`);

  await bookHere(page);
  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect(new URL(requests[1]?.url() ?? "").pathname).toBe("/api/consultation");
  expect(requests[1]?.postDataJSON()).not.toHaveProperty("invite_code");
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
  await fillAddress(page);
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
  await expect(page.getByText("Please give the building or society.")).toBeVisible();
  await expect(page.getByText("Please give the sector or area.")).toBeVisible();
  expect(requests).toHaveLength(0);
});

async function bookWith(page: Page): Promise<void> {
  await fillAddress(page);
  await page.getByLabel("Name").fill("Test Visitor");
  await page.getByLabel("Mobile").fill("9810000000");
  await page.getByText("You may contact me on WhatsApp about this consultation.").click();
  await page.getByRole("button", { name: "Book the consultation" }).click();
}

// BK-60, UX-38: Back after the pincode's answer, or after the confirmation, left /book and lost everything typed.
test("Back steps back through the page, and Forward returns to the confirmation", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeVisible();

  await page.goBack();
  expect(new URL(page.url()).pathname).toMatch(/^\/book\/?$/);
  await expect(page.getByLabel("Pincode")).toHaveValue(SERVED.pincode);
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeFocused();

  await bookWith(page);
  await expect(page.getByText("Consultation booked")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "We come to Sector 65" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book the consultation" })).toBeVisible();
  await page.goForward();
  await expect(page.getByText("Consultation booked")).toBeVisible();
});

// BK-60, UX-33: fourteen tiles read "Sat 31 … Fri 6" with no month, and a screen reader heard "Sat 31".
test("the date strip names its months, and each day in full to a screen reader", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-23T06:00:00Z"));
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();

  const dates = page.getByRole("group", { name: "Pick a date" });
  await expect(dates.getByText("October – November")).toBeVisible();
  const days = dates.getByRole("radio");
  await expect(days.first()).toHaveAccessibleName("Saturday 24 October");
  await expect(days.nth(7)).toHaveAccessibleName("Saturday 31 October");
  await expect(days.nth(8)).toHaveAccessibleName("Sunday 1 November");
});

// BK-60, UX-38, CP-21: "Building, society or street" was followed by "Street (optional)", and every optional part
// stood open.
test("the address asks for the street once, and folds the floor, tower and landmark until asked", async ({ page }) => {
  const requests = await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();

  const address = page.getByRole("group", { name: "Your address" });
  await expect(address.getByLabel("Building or society")).toBeVisible();
  await expect(address.getByLabel("Street (optional)")).toBeVisible();
  for (const folded of ["Floor (optional)", "Tower or block (optional)", "Landmark (optional)"]) {
    await expect(address.getByLabel(folded)).toHaveCount(0);
  }
  await address.getByRole("button", { name: "Add floor, tower or landmark" }).click();
  await expect(address.getByLabel("Floor (optional)")).toBeFocused();
  await expect(address.getByRole("button", { name: "Add floor, tower or landmark" })).toHaveCount(0);
  await address.getByLabel("Tower or block (optional)").fill("Tower C");

  await bookWith(page);
  await expect(page.getByText("Consultation booked")).toBeVisible();
  expect((requests[0]?.postDataJSON() as { address: Record<string, unknown> }).address).toMatchObject({
    tower: "Tower C",
    line1: "Palm Grove Society",
  });
});

// BK-60: everyone who skipped the question was recorded as crown thinning.
test("chooses nothing for the visitor where the hair loss is", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  const extent = page.getByRole("group", { name: "Extent of hair loss (optional)" });
  await expect(extent.getByRole("radio")).toHaveCount(3);
  for (const choice of await extent.getByRole("radio").all()) await expect(choice).not.toBeChecked();
});

// BK-60, UX-33: an empty check blamed the input, and "Change the pincode" was a 58 x 20 px target.
test("an empty pincode is asked for, and Change is a full-size target", async ({ page }) => {
  await mockApi(page);
  await visit(page, "/book");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByText("Enter your pincode.")).toBeVisible();

  await page.getByLabel("Pincode").fill(SERVED.pincode);
  await page.getByRole("button", { name: "Check" }).click();
  const change = page.getByRole("button", { name: "Change the pincode" });
  const box = await change.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  await change.click();
  await expect(page.getByLabel("Pincode")).toBeFocused();
  await expect(page.getByLabel("Pincode")).toHaveValue(SERVED.pincode);
});

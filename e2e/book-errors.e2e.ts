// The site's booking page refusing what it cannot send, and its date strip, steps and folds, against a mocked API
// (./book-fixtures.ts).

import { axeViolations } from "./a11y.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";
import { expect, test, visit } from "./support.ts";
import {
  SERVED,
  NOON_2_OCTOBER,
  FULL,
  openDays,
  answerOpen,
  mockApi,
  CONSULTATION_CONSENT,
  checkPincode,
  openAtPincode,
  openForm,
  openWaitlist,
  toAddress,
  fillAndBook,
  continueAndBook,
  bookHere,
  leadCalls,
} from "./book-fixtures.ts";

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
  await expect(name).toHaveAccessibleDescription("Enter your name.");
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
    .getByRole("radio", { name: "Consultation and fit · 3 hours" })
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

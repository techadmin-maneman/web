// The site's booking page with an invite remembered or not, the waitlist, and what is counted
// (docs/decisions/0089-an-invite-is-not-lost.md), against a mocked API (./book-fixtures.ts).

import { axeViolations } from "./a11y.ts";
import { fillAddress } from "./address-form.ts";
import * as siteCopy from "../site/src/content/site.ts";
import * as referralCopy from "../site/src/content/referral.ts";
import { analyticsEvents, expect, expectNoPersonalData, test, visit } from "./support.ts";
import {
  SERVED,
  UNSERVED,
  BOOKED,
  CODE,
  mockApi,
  openInvite,
  remembered,
  CONSULTATION_CONSENT,
  checkPincode,
  openForm,
  openWaitlist,
  toAddress,
  fillAndBook,
  bookHere,
  TOLD,
} from "./book-fixtures.ts";

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

  await expect(page.getByRole("heading", { level: 1, name: "Friday 25 September, 9 am–12 noon" })).toBeVisible();
  await expect(
    page.getByText("Your technician arrives in those hours. Details are on WhatsApp at +91 98100 00000."),
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
  await expect(page.getByRole("heading", { name: referralCopy.referral.consultation.title })).toHaveCount(1);
  await expect(page.getByText(/^Your technician measures your scalp and matches your colour/)).toBeVisible();
  await expect(page.getByText(referralCopy.referral.consultation.body)).toHaveCount(0);
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);

  await page.getByRole("button", { name: referralCopy.referral.pincode.changeLabel }).click();
  await checkPincode(page, UNSERVED.pincode);
  await expect(page.getByRole("button", { name: referralCopy.referral.waitlist.submit })).toBeVisible();
  // Where we do not come yet, the page no longer offers to book.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteCopy.booking.titleWaitlist);
  for (const words of invited) await expect(page.getByText(words)).toHaveCount(0);
});

test("a pincode we do not serve lists the number kept, with the launch alert offered", async ({ page }) => {
  const requests = await mockApi(page);
  await openWaitlist(page);
  await expect(page.getByText("We’re not in Bandra yet")).toBeVisible();
  await expect(page.getByText("Step 3 of 3 · The list")).toBeVisible();
  await expect(page.getByLabel(siteCopy.tryOn.gate.name, { exact: true })).toHaveCount(0);

  await page.getByText(referralCopy.referral.waitlist.contactConsent).click();
  // Joining the list is asking to be told at launch, so the box starts ticked.
  await expect(page.getByLabel(referralCopy.referral.waitlist.launchAlert)).toBeChecked();
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
    ["lead_submitted", { page: "book", served: true, window: "morning" }],
    ["booking_confirmed", { page: "book", window: "morning", state: "booked" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000", "Flat 402", "Palm Grove Society"]);

  await openWaitlist(page);
  await page.getByText(referralCopy.referral.waitlist.contactConsent).click();
  await page.getByRole("button", { name: referralCopy.referral.waitlist.submit }).click();
  await expect(page.getByRole("heading", { name: "You are on the Bandra list" })).toBeVisible();
  expect(await analyticsEvents(page)).toEqual([
    ["lead_submitted", { page: "book", served: false, window: null }],
    ["waitlist_submitted", { page: "book" }],
  ]);
  await expectNoPersonalData(page, ["Test Visitor", "9810000000", "98100 00000"]);
});

// A friend who opened an invite, left, and booked here later: the invite came with the booking, and the confirmation
// says what the landing's does (ADR 0089).
test("a friend who opened an invite books here with it, and is told the invite’s visits land when fitted", async ({
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
  await expect(page.getByText(referralCopy.referral.remembered.waitlist)).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.remembered.joinWithout })).toBeVisible();
  await page.getByText(referralCopy.referral.waitlist.contactConsent).click();
  await page.getByText(referralCopy.referral.waitlist.launchAlert).click();
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
  await expect(page.getByText(referralCopy.referral.arrival.unknown.notice)).toBeVisible();
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
test("a browser that blocks storage books on the invite’s page and here, and sends no remembered invite", async ({
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
  await expect(page.getByText("On WhatsApp, at +91 98100 00000, to fix the time.")).toBeVisible();
  await expect(page.getByRole("button", { name: referralCopy.referral.consultation.submit })).toBeHidden();
});

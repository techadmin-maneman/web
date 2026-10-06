// Booking in the app for the fitted client with an address of
// e2e/app/booker.ts, against the local mm-api, with Razorpay faked
// (e2e/app/checkout-fakes.ts): the address asked for first when there is none
// (ADR 0079), what booking also agrees to on the pay step (ADR 0080), and the
// service booked: picked first where its kind offers more than one, the one
// the app offers chosen (ADR 0085, ADR 0086).

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment } from "./picking.ts";
import { toPayment, toWindows, openSheet, profileAs, profileOf, PHOTOS, scanOf } from "./booking-fixtures.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

/** Every body the page sends to start a booking. */
function bookingsSent(page: Page): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/bookings")) sent.push(request.postDataJSON());
  });
  return sent;
}

// An address before any slot (ADR 0079).
test("asks a client with no address for it first, then books", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  // The first read finds no address; once the client has saved one, the profile is the API's own.
  let reads = 0;
  await page.route("**/api/profile", (route) => {
    reads += 1;
    return reads === 1 ? route.fulfill({ json: profileOf({ address: false }) }) : route.fallback();
  });
  await openSheet(page);
  const where = page.getByRole("dialog", { name: "Where we come" });
  await expect(where.getByText("Step 1 of 4")).toBeVisible();
  await expect(where.getByText("Your address first, so we know where to come. Then pick a date.")).toBeVisible();
  await scanOf(page);
  await where.getByLabel("Flat or house number").fill("House 4417");
  await where.getByLabel("Building, society or street").fill("Tower C");
  await where.getByLabel("Sector or area").fill("Sector 65");
  await where.getByLabel("City").fill("Gurgaon");
  await where.getByLabel("Pincode").fill("122018");
  await where.getByRole("button", { name: "Save and continue" }).click();

  const dates = page.getByRole("dialog", { name: "Pick a date" });
  await expect(dates.getByText("Step 2 of 4")).toBeVisible();
  await dates.getByRole("radio").and(page.locator(":enabled")).first().click();
  await dates.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a time" }).getByText("Step 3 of 4")).toBeVisible();
  await continueToPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
});

test("takes a client who has given their address straight to the date, as board C2 draws it", async ({ page }) => {
  await openSheet(page);
  await expect(page.getByRole("dialog", { name: "Pick a date" }).getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where we come" })).toHaveCount(0);
});

test("goes back to the address, saying why, when the API holds no slot for want of one", async ({ page }) => {
  await page.route("**/api/holds", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 409, json: { error: { code: "address_required", request_id: "e2e" } } })
      : route.fallback(),
  );
  await toWindows(page);
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
  await windows.getByRole("button", { name: "Continue to payment" }).click();
  const where = page.getByRole("dialog", { name: "Where we come" });
  await expect(where.getByRole("alert")).toHaveText(
    "We need your address before we can hold a time. Add it, then pick a time again.",
  );
  await expect(where.getByRole("button", { name: "Save and continue" })).toBeVisible();
});

// An address in a pincode we do not come to was held, paid for and booked.
test("offers no day at an address we do not come to, but the address to change and the waitlist", async ({ page }) => {
  await profileAs(page, {});
  await page.route(/\/api\/availability\?/, (route) =>
    route.fulfill({ status: 422, json: { error: { code: "not_served", request_id: "e2e" } } }),
  );
  await openSheet(page);
  const where = page.getByRole("dialog", { name: "Where we come" });
  await expect(where.getByRole("alert")).toHaveText(
    "We don’t come to 122018 yet. Change the address below, or join the waitlist and we’ll message you the day we do.",
    { timeout: 30_000 },
  );
  await expect(where.getByLabel("Pincode")).toHaveValue("122018");
  await expect(where.getByRole("button", { name: "Save and continue" })).toBeVisible();
  await expect(where.getByRole("link", { name: "Join the waitlist" })).toHaveAttribute("href", /\/book$/);
});

// Booking agrees to the photograph purposes never decided on, and what it agrees to sits one tap away beneath Pay.
test("puts Pay above what booking also agrees to, one tap away, while neither is decided, and sends both", async ({
  page,
}) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await profileAs(page, { reminders: true, undecided: PHOTOS });
  const sent = bookingsSent(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  const payButton = pay.getByRole("button", { name: "Pay Rs. 2,000" });
  const agrees = pay.getByText("What booking agrees to");
  const first = pay.getByText(
    "By booking this visit, you also agree to photographs taken for your visit record and used on referral cards.",
  );
  // On a 390 px phone the notice's six lines pushed Pay off the screen.
  await expect(payButton).toBeInViewport();
  await expect(agrees).toBeInViewport();
  expect(await bottomOf(payButton)).toBeLessThanOrEqual(await topOf(agrees));
  await expect(first).toBeHidden();

  await agrees.click();
  await expect(first).toBeVisible();
  await expect(pay.getByText("Anyone you send this card to can see your photographs.")).toBeVisible();
  await expect(pay.getByText("Your first name appears on your invite.")).toBeVisible();
  await expect(pay.getByText("You can switch either off in Profile.")).toBeVisible();
  await scanOf(page);

  await payButton.click();
  await expect(page.getByRole("dialog").getByRole("status").getByText("Confirmed")).toBeVisible();
  expect(sent).toMatchObject([{ consents: PHOTOS }]);
});

test("sends what booking agrees to with Pay, whether or not the client opened it", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await profileAs(page, { reminders: true, undecided: PHOTOS });
  const sent = bookingsSent(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await expect(pay.getByText("What booking agrees to")).toBeVisible();
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect.poll(() => sent).toMatchObject([{ consents: PHOTOS }]);
});

test("shows only the line of a purpose still undecided, and sends only that one", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await profileAs(page, { reminders: true, undecided: ["photos_own_record"] });
  const sent = bookingsSent(page);
  await toPayment(page);
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  await pay.getByText("What booking agrees to").click();
  await expect(
    pay.getByText("By booking this visit, you also agree to photographs taken for your visit record."),
  ).toBeVisible();
  await expect(pay.getByText("You can switch it off in Profile.")).toBeVisible();
  await expect(pay.getByText("Your first name appears on your invite.")).toHaveCount(0);
  await pay.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect.poll(() => sent).toMatchObject([{ consents: ["photos_own_record"] }]);
});

/** Where an element begins down the page; NaN for one not drawn, which no comparison passes. */
async function topOf(element: Locator): Promise<number> {
  const box = await element.boundingBox();
  return box === null ? Number.NaN : box.y;
}

/** Where an element ends down the page; NaN for one not drawn. */
async function bottomOf(element: Locator): Promise<number> {
  const box = await element.boundingBox();
  return box === null ? Number.NaN : box.y + box.height;
}

// The client app's login, against the local mm-api. Locally
// every code is the fixed one (OTP_FIXED_CODE in playwright.config.ts), so the
// tests can log in through the stub messaging provider, and Turnstile is the
// stand-in that e2e/support.ts gives every app test. Numbers are random.

import type { Page } from "@playwright/test";
import { DUMMY_TOKEN, expect, randomMobile, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { CODE } from "./signed-in.ts";
import { bookedNumber } from "./booked-numbers.ts";
import { holdOpen } from "./one-tap.ts";
import * as appCopy from "../../apps/app/src/content.ts";

const WRONG = "135791";

async function sendCode(page: Page, mobile: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill(mobile);
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
}

/** The sixth digit sends the code. After a wrong one the client waits for its answer, clears it and types again. */
async function enter(page: Page, code: string): Promise<void> {
  await expect(page.getByRole("button", { name: "Continue" })).not.toHaveAttribute("aria-busy", "true");
  const field = page.getByRole("textbox", { name: appCopy.login.code.label });
  await field.clear();
  await field.fill(code);
}

test("a booked number logs in with its code and lands on its consultation", async ({ page }) => {
  const mobile = bookedNumber();
  await sendCode(page, mobile);
  await expect(page.getByText(`If +91 ${mobile.slice(0, 2)}xxx x${mobile.slice(-4)} has a booking`)).toBeVisible();
  await enter(page, CODE);

  await expect(page.getByRole("heading", { level: 1, name: "Your consultation" })).toBeVisible();
  await expect(page.getByText("Morning, 9 am to 12 pm")).toBeVisible();
  await expect(page.getByText("Gurgaon", { exact: true })).toBeVisible();
  await expect(page.getByText("Free", { exact: true })).toBeVisible();
  // The site's first form booked nothing: ops confirm the time.
  await expect(page.getByText(appCopy.home.consultation.requested)).toBeVisible();
  await expect(page.getByRole("link", { name: appCopy.titles.profile })).toHaveText("RM");
  await expect(page.getByRole("link", { name: appCopy.home.reschedule })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/919007973247\?text=/,
  );
});

test("the session survives a reload, and logging out ends it", async ({ page }) => {
  await sendCode(page, bookedNumber());
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  await page.getByRole("link", { name: appCopy.titles.profile }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
});

test("a session that ends mid-use goes back to the login, says why, and returns to the page", async ({ page }) => {
  const mobile = bookedNumber();
  await sendCode(page, mobile);
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  // Home as the service worker keeps it, which the tests otherwise block.
  await page.evaluate(async () => {
    await (await caches.open("mm-app-home")).put("/api/me", new Response("{}"));
  });

  // The session ends while the app is open: it ran out, or was ended on another phone.
  await page.context().clearCookies();
  await page.getByRole("navigation").getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  await expect(page.getByText(appCopy.login.mobile.ended)).toBeVisible();
  expect(await page.evaluate(() => caches.has("mm-app-home"))).toBe(false);
  await expect(page).toHaveURL(/\/payments$/);

  await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill(mobile);
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await enter(page, CODE);
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
});

test("logging out takes the API’s word for it: offline it waits, and a refusal keeps the client in", async ({
  page,
}) => {
  await sendCode(page, bookedNumber());
  await enter(page, CODE);
  await page.getByRole("link", { name: appCopy.titles.profile }).click();
  await expect(page.getByRole("heading", { name: appCopy.profile.where })).toBeVisible();
  const logOut = page.getByRole("button", { name: "Sign out" });

  await page.context().setOffline(true);
  await expect(logOut).toBeDisabled();
  await page.context().setOffline(false);
  await expect(logOut).toBeEnabled();

  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "e2e" } } }),
  );
  await logOut.click();
  await expect(page.getByRole("alert")).toHaveText("Couldn’t sign you out. Try again.");
  await expect(page.getByRole("heading", { name: appCopy.profile.where })).toBeVisible();
});

test("the tabs reach Visits and the empty Photos, Payments and Refer", async ({ page }) => {
  await sendCode(page, bookedNumber());
  await enter(page, CODE);
  const tabs = page.getByRole("navigation");

  await tabs.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Consultation · 9 am to 12 pm")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Visits" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Your photos begin at your first visit.")).toBeVisible();
  // Nothing to show yet, so the site's try-on, whose look comes back here.
  await expect(page.getByRole("link", { name: appCopy.empty.photos.tryOn })).toHaveAttribute(
    "href",
    "http://127.0.0.1:4321/try",
  );
  await tabs.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
  await tabs.getByRole("link", { name: "Refer" }).click();
  // Refer is the invite itself now; who has been fitted is a page of its own.
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 free service visits.")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
});

test("a wrong code says so, in the design’s words, and the fifth voids it", async ({ page }) => {
  await sendCode(page, bookedNumber());
  const field = page.getByRole("textbox", { name: appCopy.login.code.label });
  for (const left of ["4 tries left.", "3 tries left.", "2 tries left.", "1 try left."]) {
    await enter(page, WRONG);
    await expect(page.getByRole("alert")).toHaveText(`That code didn’t match. ${left}`);
    await expect(field).toHaveAttribute("aria-invalid", "true");
  }
  // The next code typed takes the line away; a closed code keeps it, since typing cannot help.
  await field.fill("1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code didn’t match, and it no longer works.");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await field.fill("2");
  await expect(page.getByRole("alert")).toHaveText("That code didn’t match, and it no longer works.");

  await page.getByRole("button", { name: appCopy.login.code.fresh }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("asks for one fresh code when the client taps for one twice", async ({ page }) => {
  await sendCode(page, bookedNumber());
  for (let attempt = 0; attempt < 5; attempt += 1) await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code didn’t match, and it no longer works.");

  // A second code bills a second send, voids the first, and takes another from the day's
  // ceiling for this number: two taps can leave a client unable to log in at all.
  const held = await holdOpen(page, "**/api/auth/otp");
  const fresh = page.getByRole("button", { name: appCopy.login.code.fresh });
  await fresh.click();
  const liveWhileBusy = await fresh.isEnabled();
  // Forced, because the tap this guards against is one the client makes whether it is taken or not.
  await fresh.click({ force: true });

  // The fresh code has landed, so any second request has been sent by now: they were let go together.
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect({ asked: held.asked(), liveWhileBusy }).toEqual({ asked: 1, liveWhileBusy: false });
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("asks for a code with the token Turnstile gives", async ({ page }) => {
  const asked = page.waitForRequest((request) => request.url().endsWith("/api/auth/otp"));
  await sendCode(page, randomMobile());
  expect((await asked).postDataJSON()).toMatchObject({ turnstile_token: DUMMY_TOKEN });
});

test("says to use the last code when no other can be sent just now", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, randomMobile());
  await page.clock.runFor(31_000);
  await page.route("**/api/auth/otp/resend", (route) =>
    route.fulfill({ status: 429, json: { error: { code: "rate_limited", request_id: "e2e" } } }),
  );
  await page.getByRole("button", { name: appCopy.login.code.resend }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "We can’t send another code right now. Use the last one we sent, or message us.",
  );
  await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/919007973247",
  );
});

test("a number out of codes for the day is told so, with WhatsApp under the line", async ({ page }) => {
  await page.route("**/api/auth/otp", (route) =>
    route.fulfill({ status: 429, json: { error: { code: "rate_limited", request_id: "e2e" } } }),
  );
  await page.goto("/");
  await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill(randomMobile());
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Too many codes for this number today. Try again tomorrow, or message us.",
  );
  await expect(page.getByRole("link", { name: "Message us on WhatsApp" })).toHaveAttribute(
    "href",
    "https://wa.me/919007973247",
  );
});

test("a number with no booking sees the same screen, and no code opens it", async ({ page }) => {
  await sendCode(page, randomMobile());
  await expect(page.getByText("has a booking with us, a code is on its way on WhatsApp.")).toBeVisible();
  await enter(page, CODE);
  await expect(page.getByRole("alert")).toHaveText("That code didn’t match. 4 tries left.");
});

// The site's booking confirmation opens the app with the number typed there.
test("a link from the site’s booking fills in its number, and the code is still asked for", async ({ page }) => {
  const mobile = randomMobile();
  await page.goto(`/#mobile=${mobile}`);
  await expect(page.getByRole("textbox", { name: appCopy.login.mobile.label })).toHaveValue(mobile);
  // The number is taken off the address at once, so it is not left in the browser's history.
  await expect(page).not.toHaveURL(/mobile=/);
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
});

test("A3 is reached by choice, and points to booking and WhatsApp", async ({ page }) => {
  await sendCode(page, randomMobile());
  await page.getByRole("button", { name: "No booking on this number?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "No booking on this number?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute(
    "href",
    "http://127.0.0.1:4321/book",
  );
  await expect(page.getByRole("link", { name: "Message us" })).toHaveAttribute("href", "https://wa.me/919007973247");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
});

test("a phone’s Back steps back through the login, as its back arrows do, and never out of the app", async ({
  page,
}) => {
  await sendCode(page, randomMobile());
  await page.getByRole("button", { name: "No booking on this number?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "No booking on this number?" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();

  // Signed in, the login's steps are behind the client: Back from Home leaves the app, as it did before them.
  const mobile = bookedNumber();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill(mobile);
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await enter(page, CODE);
  await expect(page.getByRole("link", { name: appCopy.titles.profile })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.state as unknown)).toBeNull();
});

test("the WhatsApp resend counts down from 30 seconds, and SMS is offered after 30", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, randomMobile());
  await expect(page.getByText(/^Resend on WhatsApp in 30s$/)).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.login.code.sms })).toHaveCount(0);
  await page.clock.runFor(12_000);
  await expect(page.getByText(/^Resend on WhatsApp in 18s$/)).toBeVisible();
  await page.clock.runFor(18_000);
  await expect(page.getByRole("button", { name: appCopy.login.code.resend })).toBeVisible();
  // The local API has the stub SMS provider, so SMS is available here.
  await expect(page.getByRole("button", { name: appCopy.login.code.sms })).toBeVisible();
  // The count is shown and not spoken; that it has run out is said once.
  await expect(page.getByRole("status")).toHaveText(appCopy.login.code.canResend);
});

test("the resend’s count runs from when the code was sent, across the help screen and back", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, randomMobile());
  await page.clock.runFor(3_000);
  await page.getByRole("button", { name: "No booking on this number?" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText(/^Resend on WhatsApp in 27s$/)).toBeVisible();
});

test("says the code is read automatically only when it comes by SMS, the one a phone can read", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, bookedNumber());
  await expect(page.getByText(appCopy.login.code.automatic)).toHaveCount(0);
  await page.clock.runFor(31_000);
  // The API counts its 30 seconds on its own clock, which the page's has run ahead of, so it answers here.
  await page.route("**/api/auth/otp/sms", (route) =>
    route.fulfill({
      status: 202,
      json: {
        challenge_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        channel: "sms",
        expires_in_s: 600,
        resend_in_s: 30,
        sms_in_s: null,
      },
    }),
  );
  await page.getByRole("button", { name: appCopy.login.code.sms }).click();
  await expect(page.getByText("a code is on its way by SMS.")).toBeVisible();
  await expect(page.getByText(appCopy.login.code.automatic)).toBeVisible();
});

test("names each login screen in the browser’s title, and puts focus where the client carries on", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Your mobile number · Mane Man");
  await sendCode(page, bookedNumber());
  await expect(page).toHaveTitle("Enter the code · Mane Man");
  const field = page.getByRole("textbox", { name: appCopy.login.code.label });
  await expect(field).toBeFocused();

  await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code didn’t match. 4 tries left.");
  await expect(field).toBeFocused();

  await page.getByRole("button", { name: "No booking on this number?" }).click();
  await expect(page).toHaveTitle("No booking on this number? · Mane Man");
  await expect(page.getByRole("heading", { level: 1, name: "No booking on this number?" })).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(field).toBeFocused();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your mobile number" })).toBeFocused();
});

test("offers no SMS where the API has no SMS provider", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/auth/otp", (route) =>
    route.fulfill({
      status: 202,
      json: {
        challenge_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        channel: "whatsapp",
        expires_in_s: 600,
        resend_in_s: 30,
        sms_in_s: null,
      },
    }),
  );
  await sendCode(page, randomMobile());
  await page.clock.runFor(31_000);
  await expect(page.getByRole("button", { name: appCopy.login.code.resend })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.login.code.sms })).toHaveCount(0);
});

test("an invalid number is caught before it is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: appCopy.login.mobile.label }).fill("12345");
  await page.getByRole("button", { name: appCopy.login.mobile.send }).click();
  await expect(page.getByRole("alert")).toHaveText(appCopy.login.mobile.errors.invalid);
});

test("each login screen, and Home, meets WCAG 2.2 AA", async ({ page }) => {
  const scan = async () => {
    expect(await axeViolations(page)).toEqual([]);
  };
  await sendCode(page, bookedNumber());
  await scan();
  await enter(page, WRONG);
  await scan();
  await page.getByRole("button", { name: "No booking on this number?" }).click();
  await scan();
  await page.getByRole("button", { name: "Back" }).click();
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  await scan();
});

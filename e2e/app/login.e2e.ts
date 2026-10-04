// The client app's login (boards A1 to A3), against the local mm-api. Locally
// every code is the fixed one (OTP_FIXED_CODE in playwright.config.ts), so the
// tests can log in through the stub messaging provider, and Turnstile is the
// stand-in that e2e/support.ts gives every app test. Numbers are random.

import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DUMMY_TOKEN, expect, randomMobile, test } from "../support.ts";
import { bookedNumber } from "./booked-numbers.ts";
import { holdOpen } from "./one-tap.ts";

const CODE = "246810";
const WRONG = "135791";

async function sendCode(page: Page, mobile: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Enter the code" })).toBeVisible();
}

async function enter(page: Page, code: string): Promise<void> {
  await page.getByRole("textbox", { name: "The six-digit code" }).fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
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
  // Phase 1's form booked nothing: ops confirm the time.
  await expect(page.getByText("Requested · we confirm the time on WhatsApp")).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile" })).toHaveText("RM");
  await expect(page.getByRole("link", { name: "Reschedule" })).toHaveAttribute(
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
  await page.getByRole("link", { name: "Your profile" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
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
  await expect(page.getByText("Your session has ended. Log in again to carry on.")).toBeVisible();
  expect(await page.evaluate(() => caches.has("mm-app-home"))).toBe(false);
  await expect(page).toHaveURL(/\/payments$/);

  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await enter(page, CODE);
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
});

test("logging out takes the API's word for it: offline it waits, and a refusal keeps the client in", async ({
  page,
}) => {
  await sendCode(page, bookedNumber());
  await enter(page, CODE);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  const logOut = page.getByRole("button", { name: "Log out" });

  await page.context().setOffline(true);
  await expect(logOut).toBeDisabled();
  await page.context().setOffline(false);
  await expect(logOut).toBeEnabled();

  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "e2e" } } }),
  );
  await logOut.click();
  await expect(page.getByRole("alert")).toHaveText(
    "That did not go through, so you are still logged in here. Please try again.",
  );
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
});

test("the tabs reach Visits and the empty Photos, Payments and Refer", async ({ page }) => {
  await sendCode(page, bookedNumber());
  await enter(page, CODE);
  const tabs = page.getByRole("navigation");

  await tabs.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Consultation · 9 am to 12 pm")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Visits" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Your photographs start at your first visit.")).toBeVisible();
  await tabs.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
  await tabs.getByRole("link", { name: "Refer" }).click();
  // Refer is the invite itself now (board F1); who has been fitted is a page of its own.
  await expect(page.getByText("When a friend you refer is fitted, you both get 3 free service visits.")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
});

test("a wrong code says so, in the design's words, and the fifth voids it", async ({ page }) => {
  await sendCode(page, bookedNumber());
  const field = page.getByRole("textbox", { name: "The six-digit code" });
  for (const left of ["Four attempts left.", "Three attempts left.", "Two attempts left.", "One attempt left."]) {
    await enter(page, WRONG);
    await expect(page.getByRole("alert")).toHaveText(`That code did not match. ${left}`);
    await expect(field).toHaveAttribute("aria-invalid", "true");
  }
  await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code did not match. It no longer works.");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await enter(page, CODE);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
});

test("asks for one fresh code when the client taps for one twice", async ({ page }) => {
  await sendCode(page, bookedNumber());
  for (let attempt = 0; attempt < 5; attempt += 1) await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code did not match. It no longer works.");

  // A second code bills a second send, voids the first, and takes another from the day's
  // ceiling for this number: two taps can leave a client unable to log in at all.
  const held = await holdOpen(page, "**/api/auth/otp");
  const fresh = page.getByRole("button", { name: "Send a new code" });
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
  await page.getByRole("button", { name: "Resend on WhatsApp" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "We cannot send another code just now. Use the last one we sent, or message us.",
  );
});

test("a number with no booking sees the same screen, and no code opens it", async ({ page }) => {
  await sendCode(page, randomMobile());
  await expect(page.getByText("has a booking with us, a code is on its way on WhatsApp.")).toBeVisible();
  await enter(page, CODE);
  await expect(page.getByRole("alert")).toHaveText("That code did not match. Four attempts left.");
});

// The site's booking confirmation opens the app with the number typed there.
test("a link from the site's booking fills in its number, and the code is still asked for", async ({ page }) => {
  const mobile = randomMobile();
  await page.goto(`/#mobile=${mobile}`);
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toHaveValue(mobile);
  // The number is taken off the address at once, so it is not left in the browser's history.
  await expect(page).not.toHaveURL(/mobile=/);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
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

test("a phone's Back steps back through the login, as its back arrows do, and never out of the app", async ({
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
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await enter(page, CODE);
  await expect(page.getByRole("link", { name: "Your profile" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.history.state as unknown)).toBeNull();
});

test("the WhatsApp resend counts down from 30 seconds, and SMS is offered after 30", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, randomMobile());
  await expect(page.getByText(/^Resend on WhatsApp in 30s$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send by SMS instead" })).toHaveCount(0);
  await page.clock.runFor(12_000);
  await expect(page.getByText(/^Resend on WhatsApp in 18s$/)).toBeVisible();
  await page.clock.runFor(18_000);
  await expect(page.getByRole("button", { name: "Resend on WhatsApp" })).toBeVisible();
  // The local API has the stub SMS provider, so SMS is available here.
  await expect(page.getByRole("button", { name: "Send by SMS instead" })).toBeVisible();
  // The count is shown and not spoken; that it has run out is said once.
  await expect(page.getByRole("status")).toHaveText("You can ask for a new code now.");
});

test("says the code is read automatically only when it comes by SMS, the one a phone can read", async ({ page }) => {
  await page.clock.install();
  await sendCode(page, bookedNumber());
  await expect(page.getByText("Read automatically where your phone allows")).toHaveCount(0);
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
  await page.getByRole("button", { name: "Send by SMS instead" }).click();
  await expect(page.getByText("a code is on its way by SMS.")).toBeVisible();
  await expect(page.getByText("Read automatically where your phone allows")).toBeVisible();
});

test("names each login screen in the browser's title, and puts focus where the client carries on", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Your mobile number · Mane Man");
  await sendCode(page, bookedNumber());
  await expect(page).toHaveTitle("Enter the code · Mane Man");
  const field = page.getByRole("textbox", { name: "The six-digit code" });
  await expect(field).toBeFocused();

  await enter(page, WRONG);
  await expect(page.getByRole("alert")).toHaveText("That code did not match. Four attempts left.");
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
  await expect(page.getByRole("button", { name: "Resend on WhatsApp" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send by SMS instead" })).toHaveCount(0);
});

test("an invalid number is caught before it is sent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Mobile number" }).fill("12345");
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter the ten-digit mobile number you booked with.");
});

test("each login screen, and Home, meets WCAG 2.2 AA", async ({ page }) => {
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

// The client app's login (boards A1 to A3), against the local mm-api. Locally
// every code is the fixed one (OTP_FIXED_CODE in playwright.config.ts), so the
// tests can log in through the stub messaging provider. Numbers are random.

import type { APIRequestContext, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DUMMY_TOKEN, expect, randomMobile, test } from "../support.ts";

const CODE = "246810";
const WRONG = "135791";

/** Books a consultation through the public site's API, so the number may log in. */
async function booked(request: APIRequestContext, name = "Rohit Malhotra"): Promise<string> {
  const mobile = randomMobile();
  const response = await request.post("http://127.0.0.1:8787/api/lead", {
    data: {
      name,
      mobile,
      city: "Gurgaon",
      first_choice_window: "weekday_am",
      loss_extent: "crown",
      consent: true,
      turnstile_token: DUMMY_TOKEN,
    },
  });
  expect(response.status()).toBe(201);
  return mobile;
}

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

test("a booked number logs in with its code and lands on its consultation", async ({ page, request }) => {
  const mobile = await booked(request);
  await sendCode(page, mobile);
  await expect(page.getByText(`If +91 ${mobile.slice(0, 2)}xxx x${mobile.slice(-4)} has a booking`)).toBeVisible();
  await enter(page, CODE);

  await expect(page.getByRole("heading", { level: 1, name: "Your consultation" })).toBeVisible();
  await expect(page.getByText("Morning, 9 am to 12 pm")).toBeVisible();
  await expect(page.getByText("Gurgaon", { exact: true })).toBeVisible();
  await expect(page.getByText("Free · nothing to pay")).toBeVisible();
  await expect(page.getByRole("link", { name: "Your profile" })).toHaveText("RM");
  await expect(page.getByRole("link", { name: "Reschedule" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/919007973247\?text=/,
  );
});

test("the session survives a reload, and logging out ends it", async ({ page, request }) => {
  await sendCode(page, await booked(request));
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

test("the tabs reach Visits and the empty Photos, Payments and Refer", async ({ page, request }) => {
  await sendCode(page, await booked(request));
  await enter(page, CODE);
  const tabs = page.getByRole("navigation");

  await tabs.getByRole("link", { name: "Visits" }).click();
  await expect(page.getByText("Consultation · 9 am to 12 pm")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Visits" })).toHaveAttribute("aria-current", "page");
  await tabs.getByRole("link", { name: "Photos" }).click();
  await expect(page.getByText("Your photographs start at your first fit.")).toBeVisible();
  await tabs.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
  await tabs.getByRole("link", { name: "Refer" }).click();
  await expect(page.getByText("Nobody you have referred has been fitted yet.")).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Nothing to pay yet.")).toBeVisible();
});

test("a wrong code says so, in the design's words, and the fifth voids it", async ({ page, request }) => {
  await sendCode(page, await booked(request));
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

test("a number with no booking sees the same screen, and no code opens it", async ({ page }) => {
  await sendCode(page, randomMobile());
  await expect(page.getByText("has a booking with us, a code is on its way on WhatsApp.")).toBeVisible();
  await enter(page, CODE);
  await expect(page.getByRole("alert")).toHaveText("That code did not match. Four attempts left.");
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

test("each login screen, and Home, meets WCAG 2.2 AA", async ({ page, request }) => {
  const scan = async () => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  };
  await sendCode(page, await booked(request));
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

// A client with a consultation booked, logged in to the app with the local fixed
// code (OTP_FIXED_CODE in playwright.config.ts), on Home.

import type { APIRequestContext, Page } from "@playwright/test";
import { DUMMY_TOKEN, expect, randomMobile } from "../support.ts";

export const CODE = "246810";

/** Books a consultation for a new number, logs in with it, and returns the number. */
export async function signIn(page: Page, request: APIRequestContext): Promise<string> {
  const mobile = randomMobile();
  const booking = await request.post("http://127.0.0.1:8787/api/lead", {
    data: {
      name: "Rohit Malhotra",
      mobile,
      city: "Gurgaon",
      first_choice_window: "weekday_pm",
      loss_extent: "receding",
      consent: true,
      turnstile_token: DUMMY_TOKEN,
    },
  });
  expect(booking.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await page.getByRole("textbox", { name: "The six-digit code" }).fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  return mobile;
}

// A client with a consultation booked, logged in to the app with the local fixed
// code (OTP_FIXED_CODE in playwright.config.ts), on Home.

import type { Page } from "@playwright/test";
import { LOCAL_LOGIN_CODE } from "../../scripts/lib/local-stack.ts";
import { expect } from "../support.ts";
import { bookedNumber } from "./booked-numbers.ts";

export const CODE = LOCAL_LOGIN_CODE;

/** Logs in with a number of its own that has a consultation to come, and returns the number. */
export async function signIn(page: Page): Promise<string> {
  const mobile = bookedNumber();
  await logIn(page, mobile);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  return mobile;
}

/** Logs in with a number that may, from the app's first screen. */
export async function logIn(page: Page, mobile: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Mobile number" }).fill(mobile);
  await page.getByRole("button", { name: "Send code on WhatsApp" }).click();
  await page.getByRole("textbox", { name: "The six-digit code" }).fill(CODE);
  await page.getByRole("button", { name: "Continue" }).click();
}

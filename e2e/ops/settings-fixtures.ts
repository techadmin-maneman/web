// What the console's settings tests share (settings*.e2e.ts): the API's answers for every panel, each panel opened, and
// what it posted.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { answer, BLACKOUTS, DISCOUNT_CODES, json, SERVICE_AREA, SERVICES, SETTINGS, type Answers } from "./fixtures.ts";

export const ROUTES: Answers = {
  "GET /api/settings": json(SETTINGS),
  "GET /api/services": json(SERVICES),
  "GET /api/service-area": json(SERVICE_AREA),
  "GET /api/blackouts": json(BLACKOUTS),
  "GET /api/discount-codes": json(DISCOUNT_CODES),
};

/** The panels that were tabs of Settings and are now in sections of their own departments, by their headings. */
export const OWN_SECTIONS: Readonly<Record<string, string>> = {
  "/prices": "Prices",
  "/discount-codes": "Discount codes",
  "/areas/served": "Areas",
};

export async function open(page: Page, path = "/settings", extra: Answers = {}): Promise<void> {
  await answer(page, { ...ROUTES, ...extra });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: OWN_SECTIONS[path] ?? "Settings" })).toBeVisible();
}

export const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

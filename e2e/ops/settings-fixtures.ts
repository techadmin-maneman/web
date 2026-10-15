// What the console's settings tests share (settings*.e2e.ts): the API's answers for every panel, each panel opened, and
// what it posted.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { settingsPageNames } from "../../apps/ops/src/content/settings-shell.ts";
import type { SettingsTab } from "../../apps/ops/src/route.ts";
import { answer, BLACKOUTS, DISCOUNT_CODES, json, SERVICE_AREA, SERVICES, SETTINGS, type Answers } from "./fixtures.ts";

export const ROUTES: Answers = {
  "GET /api/settings": json(SETTINGS),
  "GET /api/services": json(SERVICES),
  "GET /api/standard-costs": json({ products: [] }),
  "GET /api/service-area": json(SERVICE_AREA),
  "GET /api/blackouts": json(BLACKOUTS),
  "GET /api/discount-codes": json(DISCOUNT_CODES),
};

/** A Settings page by its path's last part: "/settings/booking" is headed "Booking". */
export async function open(page: Page, path: `/settings/${SettingsTab}`, extra: Answers = {}): Promise<void> {
  await answer(page, { ...ROUTES, ...extra });
  await page.goto(path);
  const tab = path.slice("/settings/".length) as SettingsTab;
  await expect(page.getByRole("heading", { level: 1, name: settingsPageNames[tab] })).toBeVisible();
}

export const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

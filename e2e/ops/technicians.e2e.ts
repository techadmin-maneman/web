// Technicians (board D3): the roster and the phones each has logged in on,
// with a revoke. The API is answered from e2e/ops/fixtures.ts, since a local
// database has no technician until FSM's mirror has run and none has logged in.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, TECHNICIANS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const REVOKE = "/api/technicians/88000000-0000-4000-8000-000000000001/devices/device-1/revoke";
const PHONE = "Revoke Chrome on Android of Imran Qureshi";

async function open(page: Page, revoke = json({ revoked_at: "2027-09-22T06:00:00.000Z" })): Promise<void> {
  await answer(page, { "/api/technicians": json(TECHNICIANS), [REVOKE]: revoke });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

test("lists every active technician with the zone the board draws", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 40–65");
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("Sec 1–39");
  // A technician the mirror has no zone for reads as a gap, as the design's tables write one.
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("—");
});

test("shows each technician's phones, and says when one is revoked already", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Chrome on Android")).toBeVisible();
  await expect(page.getByText("last used 22 Sep 2027")).toBeVisible();
  await expect(page.getByText("Revoked 5 Aug 2027")).toBeVisible();
  // A phone whose browser gave no label at login, and a technician who has logged in on none.
  await expect(page.getByText("A phone")).toBeVisible();
  await expect(page.getByText("No phone logged in.")).toBeVisible();
});

test("offers no revoke on a phone that is revoked already", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Revoke Safari on iPhone of Imran Qureshi" })).toBeHidden();
});

test("asks before it revokes a phone, and says what a revoke does", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: PHONE }).click();
  await expect(page.getByText("The session ends, and the phone drops its cached jobs")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(REVOKE) && request.method() === "POST");
  await page.getByRole("button", { name: "Revoke this phone" }).click();
  await sent;
  await expect(page.getByText("Revoked 22 Sep 2027")).toBeVisible();
});

test("keeps the phone when the revoke is called off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: PHONE }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: PHONE })).toBeVisible();
  await expect(page.getByText("Revoked 22 Sep 2027")).toBeHidden();
});

test("says so when the phone is no longer that technician's", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: PHONE }).click();
  await page.getByRole("button", { name: "Revoke this phone" }).click();
  await expect(page.getByRole("alert")).toContainText("That phone is not this technician's any more.");
});

test("says so when the roster cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/technicians": fails(503, "unavailable") });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/technicians": json(TECHNICIANS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
});

test("says so when no technician is active", async ({ page }) => {
  await answer(page, { "/api/technicians": json({ technicians: [] }) });
  await page.goto("/technicians");
  await expect(page.getByText("No technician is active.")).toBeVisible();
});

test("meets WCAG 2.2 AA with a roster, and with a revoke open", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: PHONE }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);
});

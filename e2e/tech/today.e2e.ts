// Boards A1, A2 and A3: the day's jobs, the empty state, the offline banner,
// and one job's card with its locked version.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fakeTech, JOB_ID } from "./fixtures.ts";

const wcag = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

test("lists the day's jobs in order, with no amount anywhere (board A1)", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText("First at 9:30 am · Sector 65")).toBeVisible();

  const rows = page.getByRole("listitem");
  // The client's name arrives with the card, which the day's list does not carry.
  await expect(rows.first()).toContainText("Rohit M.");
  await expect(rows.first()).toContainText("Sector 65");
  await expect(rows.first()).toContainText("Prepaid");
  await expect(rows.nth(1)).toContainText("Credit");

  // "No money anywhere in the technician app": a badge only.
  await expect(page.locator("body")).not.toContainText("₹");
  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("says nothing is booked when the day is empty (board A2)", async ({ page }) => {
  await fakeTech(page, true);
  await page.goto("/");
  await expect(page.getByText("Nothing booked for today")).toBeVisible();
  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("shows board A2's banner with no signal, and the card still opens from the phone", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // The card is opened once with signal, so the phone is holding it.
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // Into a basement. The app is already open, as it is on a technician's phone.
  fake.online = false;
  await context.setOffline(true);

  await expect(page.getByText("No signal · working offline")).toBeVisible();
  await expect(
    page.getByText("Today's jobs and cards are on the phone. Photos go up when signal returns."),
  ).toBeVisible();
  await expect(page.getByText("Rohit M.").first()).toBeVisible();

  // The card comes from what the phone kept, not from the API, which cannot be reached.
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();

  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("opens a job's card with its address, access notes and the way in (board A3)", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByText("Rohit M.").first().click();

  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();
  await expect(page.getByText("9:30 am · service")).toBeVisible();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate code 4417 · visitor bay B")).toBeVisible();
  // A Maps URL now, not `geo:`, which an iPhone ignores (ADR 0054; e2e/tech/job.e2e.ts).
  await expect(page.getByRole("link", { name: "Navigate" })).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/dir\//,
  );
  await expect(page.getByRole("button", { name: "I have arrived" })).toBeVisible();

  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("a job further out shows time, type and sector only, and cannot be started", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByRole("listitem").nth(2).click();

  await expect(page.getByText("The address and the client's card open the day before.")).toBeVisible();
  await expect(page.getByText("Sector 43")).toBeVisible();
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
});

test("every target is at least the design's 48 px, and the primary action is 64", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  const arrive = page.getByRole("button", { name: "I have arrived" });
  await expect(arrive).toBeVisible();

  const box = await arrive.boundingBox();
  expect(box?.height).toBe(64);
  expect(Math.round(box?.width ?? 0)).toBe(390 - 40);

  for (const target of await page.getByRole("button").all()) {
    const each = await target.boundingBox();
    expect(each?.height ?? 0, "nothing under 48 px").toBeGreaterThanOrEqual(44);
  }
});

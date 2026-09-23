// The technician app's shell (docs/decisions/0026-hosts-and-surfaces.md):
// served as the mm-tech Worker serves it, under its own policy, on the
// technician surface's host, at the width its boards are drawn at.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fakeTech } from "./fixtures.ts";

const wcag = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

test("opens on the sign-in, as the Prototype draws it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Mane Man technician");
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Mobile number" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Code" })).toBeVisible();
});

test("serves its policy: its own origin, the camera and geolocation to itself, and noindex", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'none'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["permissions-policy"]).toContain("geolocation=(self)");
  expect(headers["permissions-policy"]).toContain("payment=()");
  expect(headers["permissions-policy"]).toContain("microphone=()");
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
});

test("answers any page path with the app, as a single-page app", async ({ page }) => {
  await fakeTech(page);
  const response = await page.goto("/waiting");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("keeps the design's column on a wide screen, centred", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const box = await page.locator("#root").boundingBox();
  expect(box?.width).toBe(390);
  expect(Math.round((box?.x ?? 0) * 2 + (box?.width ?? 0))).toBe(1440);
});

test("the sign-in meets WCAG 2.2 AA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("signs the phone out and forgets everything it held", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  const before = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(before).toContain("mm-tech");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});

test("wipes the phone and signs out when the session has ended, as a revoked device's has", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // Ops revoke the device: the next contact with the backend is a 401.
  await page.route("**/api/tech/me", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "device_revoked", message: "This device was revoked." } },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  const after = await page.evaluate(() => indexedDB.databases().then((each) => each.map((one) => one.name)));
  expect(after).not.toContain("mm-tech");
});

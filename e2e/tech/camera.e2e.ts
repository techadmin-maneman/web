// Board B1's capture, and the upload that follows it. Chromium runs with a fake
// camera, so no real one and no photograph of anyone is involved.
//
// What matters here is that the frame comes from the camera into a canvas, is
// re-encoded to about the size ADR 0039's budget assumes, goes into the app's
// own store rather than the phone's gallery, and leaves that store only when
// the API has confirmed it.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fakeTech, heldOnPhone, JOB_ID } from "./fixtures.ts";

const TARGET_BYTES = 250 * 1024;
const BEFORE = `/jobs/${JOB_ID}/before-photos`;

const wcag = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

test("captures the five before angles into the app's own store, never a file input", async ({ page }) => {
  await fakeTech(page);
  await page.goto(BEFORE);

  await expect(page.getByText("Before photos")).toBeVisible();
  await expect(page.getByText("0 of 5")).toBeVisible();

  // A file input is what could write to the camera roll; this screen has none.
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(page.locator("[capture]")).toHaveCount(0);

  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  const midway = await wcag(page);
  expect(midway.violations.map((violation) => violation.id)).toEqual([]);

  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }

  const held = await heldOnPhone(page);
  expect(held.frames).toBe(5);
  for (const size of held.frameSizes) expect(size).toBeLessThanOrEqual(TARGET_BYTES);
  expect(Math.min(...held.frameSizes)).toBeGreaterThan(0);

  // Once five are taken there is nothing more to capture.
  await expect(capture).toBeDisabled();
});

test("Retake drops the last frame from the phone", async ({ page }) => {
  await fakeTech(page);
  await page.goto(BEFORE);

  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText("1 of 5")).toBeVisible();
  expect((await heldOnPhone(page)).frames).toBe(1);

  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByText("0 of 5")).toBeVisible();
  expect((await heldOnPhone(page)).frames).toBe(0);
});

test("uploads each frame to the link the API hands out, then lands the set", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto(BEFORE);

  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) await capture.click();
  await expect(page.getByText("5 of 5")).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();

  // One PUT per angle, in the order the design guides them, and then the set itself.
  await expect
    .poll(() => fake.photos, { timeout: 15_000 })
    .toEqual(["before-front", "before-top", "before-left", "before-right", "before-hair"]);
  await expect.poll(() => fake.writes.map((write) => write.path)).toContain(`/api/tech/jobs/${JOB_ID}/photos`);

  // Confirmed: the frames leave the phone, and nothing of the client's stays on it.
  await expect.poll(async () => (await heldOnPhone(page)).frames).toBe(0);
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
});

test("the frames waiting show on the waiting screen, with the design's line about the gallery", async ({ page }) => {
  await fakeTech(page);
  await page.goto(BEFORE);
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText("1 of 5")).toBeVisible();

  // A frame goes up only with the set it belongs to, so this one waits.
  await page.goto("/waiting");
  await expect(page.getByText("1 photo set waiting")).toBeVisible();
  await expect(page.getByText("Never written to this phone's gallery.")).toBeVisible();
});

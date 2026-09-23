// Board B1's capture. Chromium runs with a fake camera, so no real one and no
// photograph of anyone is involved.
//
// What matters here is that the frame comes from the camera into a canvas, is
// re-encoded to about the size ADR 0039's budget assumes, and goes into the
// app's own store rather than the phone's gallery.

import { expect, test } from "../support.ts";
import { fakeTech, heldOnPhone, JOB_ID } from "./fixtures.ts";

const TARGET_BYTES = 250 * 1024;

test("captures the five before angles into the app's own store, never a file input", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}/photos`);

  await expect(page.getByText("Before photos")).toBeVisible();
  await expect(page.getByText("0 of 5")).toBeVisible();

  // A file input is what could write to the camera roll; this screen has none.
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(page.locator("[capture]")).toHaveCount(0);

  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
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
  await page.goto(`/jobs/${JOB_ID}/photos`);

  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText("1 of 5")).toBeVisible();
  expect((await heldOnPhone(page)).frames).toBe(1);

  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByText("0 of 5")).toBeVisible();
  expect((await heldOnPhone(page)).frames).toBe(0);
});

test("the frames waiting show on the waiting screen, with the design's line about the gallery", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}/photos`);
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText("1 of 5")).toBeVisible();

  await page.goto("/waiting");
  await expect(page.getByText("1 photo set waiting")).toBeVisible();
  await expect(page.getByText("Never written to this phone's gallery.")).toBeVisible();
});

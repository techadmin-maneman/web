// Boards B2 to B5: the in-job steps, and the evidence chain when the client is
// not home. The whole of a service visit is walked once, and the no-show is
// refused before its wait is over.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { atTheDoor, fakeTech, JOB_ID } from "./fixtures.ts";

const wcag = (page: Page) =>
  new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();

const capture = async (page: Page) => {
  const take = page.getByRole("button", { name: "Capture" });
  await expect(take).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) await take.click();
  await page.getByRole("button", { name: "Done" }).click();
};

test("checks in at the door, and records the time and the distance (board B5)", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText("1 · Arrived")).toBeVisible();
  await expect(page.getByText("Tap at the door. We record the time and check you are within 200 m.")).toBeVisible();
  await page.getByRole("button", { name: "I have arrived" }).click();

  await expect(page.getByText("2 · Waiting")).toBeVisible();
  await expect(page.getByText(/left of 15 minutes/)).toBeVisible();
  const checkIn = fake.writes.find((write) => write.path.endsWith("/checkin"));
  expect(checkIn?.body).toMatchObject({ lat: 28.39, lng: 77.07 });

  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("refuses a check-in from away, and says how far, with no way to close a no-show", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.checkIn = { passed: false, distance_m: 1400 };
  await atTheDoor(page, 28.42, 77.12);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByText("Check-in failed")).toBeVisible();
  await expect(page.getByText("You are 1.4 km from the address.")).toBeVisible();
  await expect(page.getByText("Get to the door and tap again. No-show cannot be recorded from here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close as no-show" })).toHaveCount(0);

  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("keeps Close as no-show dim until the wait has run out, and the API refuses it early", async ({ page }) => {
  const fake = await fakeTech(page);
  // A four-second wait, so the button is plainly dim first and plainly open after.
  fake.waitMinutes = 4 / 60;
  fake.tooEarly = true;
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();

  const close = page.getByRole("button", { name: "Close as no-show" });
  await expect(close).toBeVisible();
  await expect(close).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start job" })).toBeEnabled();

  // The wait runs out on the phone and the button opens; the API still refuses
  // it, as it does whenever the phone's clock has run ahead of ours.
  await expect(close).toBeEnabled({ timeout: 15_000 });
  await close.click();

  // Refused with 425: nothing was recorded, and nothing is left stuck in the queue.
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(0);
  await page.goto("/waiting");
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
});

test("closes the job as a no-show once the wait has run", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitMinutes = 1 / 60;
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();

  const close = page.getByRole("button", { name: "Close as no-show" });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();

  await expect(page.getByText("Rohit M. · no-show")).toBeVisible();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
});

test("walks the six steps of a service visit and closes it out (boards B1 to B4)", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: "I have arrived" }).click();
  await page.getByRole("button", { name: "Start job" }).click();

  // Step 1: the before set.
  await expect(page.getByText("Before photos")).toBeVisible();
  await expect(page.getByText("1 of 5")).toHaveCount(0);
  await capture(page);

  // Step 2: the checklist, which will not let the job on until it is finished.
  await expect(page.getByText("Service checklist")).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish the list to continue" })).toBeDisabled();
  const items = page.getByRole("button", { name: /PLACEHOLDER/ });
  for (const item of await items.all()) await item.click();
  const wcagOnChecklist = await wcag(page);
  expect(wcagOnChecklist.violations.map((violation) => violation.id)).toEqual([]);
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: the consumables' steppers, no keyboard anywhere.
  await expect(page.getByText("Consumables used")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 5: the after set. A service visit has no piece step; the API leaves it out.
  await expect(page.getByText("After photos")).toBeVisible();
  await capture(page);

  // Step 6: the outcome.
  await expect(page.getByText("Outcome")).toBeVisible();
  await page.getByRole("button", { name: "Partial · pick a reason" }).click();
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // The close-out.
  await expect(page.getByText("Rohit M. · partial")).toBeVisible();
  await expect(page.getByText("Duration")).toBeVisible();
  await expect(page.getByRole("button", { name: /Next job · 11:30/ })).toBeVisible();

  const sent = fake.writes.map((write) => write.path.replace(`/api/tech/jobs/${JOB_ID}`, ""));
  expect(sent).toEqual(["/checkin", "/start", "/photos", "/checklist", "/consumables", "/photos", "/outcome"]);
  expect(fake.writes.at(-1)?.body).toEqual({ outcome: "partial", reason: "client_stopped_it" });

  const results = await wcag(page);
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

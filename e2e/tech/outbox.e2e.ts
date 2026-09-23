// The offline outbox: what the technician does in a basement is held on the
// phone and replayed in order when the signal returns, and a job that FSM
// changed underneath says what changed rather than a generic error.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fakeTech, heldOnPhone, JOB_ID, type Fake } from "./fixtures.ts";

/**
 * Opens the day, then the job's card, then takes the signal away. The app stays
 * open throughout, as it does on a technician's phone walking into a basement:
 * it has no service worker yet, so a reload with no signal is a blank page.
 */
async function intoTheBasement(page: Page, context: { setOffline: (offline: boolean) => Promise<void> }, fake: Fake) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await page.getByText("Rohit M.").click();
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();

  fake.online = false;
  await context.setOffline(true);
}

test("holds what the technician does with no signal, and replays it when the signal returns", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);

  // No signal, and the job starts anyway.
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();

  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });
  expect(fake.writes).toEqual([]);

  // Back on the road.
  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => fake.writes.length, { timeout: 15_000 }).toBe(1);

  const [write] = fake.writes;
  expect(write?.path).toBe(`/api/tech/jobs/${JOB_ID}/start`);
  // The client-generated event ID the backend makes each write idempotent on.
  expect(write?.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
});

test("accounts plainly for what has not reached us, and says what changed on a supersede", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);

  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();

  // Today says what is waiting, without a number of bytes or a spinner.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("link", { name: /1 action waiting/ })).toBeVisible();
  await page.getByRole("link", { name: /1 action waiting/ }).click();
  await expect(page.getByRole("heading", { name: "Waiting to reach us" })).toBeVisible();
  await expect(page.getByText("Rohit M.")).toBeVisible();

  // Ops moved the job while the phone was in the basement. The replay meets a
  // 409, and the screen says what changed, in the API's own words.
  fake.supersede = "Ops moved this job to Sandeep at 10:40";
  fake.online = true;
  await context.setOffline(false);

  await expect(page.getByText("Ops moved this job to Sandeep at 10:40")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // Read and dealt with: the job's queue goes, and nothing is left waiting.
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 0 });
});

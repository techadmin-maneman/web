// The offline outbox: what the technician does in a basement is held on the
// phone and replayed in order when the signal returns, and a job that FSM
// changed underneath says what changed rather than a generic error.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { atTheDoor, fakeTech, heldOnPhone, JOB_ID, type Fake } from "./fixtures.ts";

/**
 * Opens the day, checks in at the door, then takes the signal away. The app
 * stays open throughout, as it does on a technician's phone walking into a
 * basement; that it also reopens with no connection is e2e/tech/offline.e2e.ts.
 */
async function intoTheBasement(page: Page, context: { setOffline: (offline: boolean) => Promise<void> }, fake: Fake) {
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();

  fake.online = false;
  await context.setOffline(true);
}

test("holds a step taken with no signal, and replays it when the signal returns", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);
  const already = fake.writes.length;

  // No signal, and the job starts anyway.
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();

  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });
  expect(fake.writes.length).toBe(already);

  // Back on the road.
  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => fake.writes.length, { timeout: 15_000 }).toBe(already + 1);

  const write = fake.writes.at(-1);
  expect(write?.path).toBe(`/api/tech/jobs/${JOB_ID}/start`);
  // The client-generated event ID the backend makes each write idempotent on.
  expect(write?.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);
});

test("warns when the phone will not promise to keep the queue, and says how long it has waited", async ({
  page,
  context,
}) => {
  // WebKit grants persistent storage on heuristics and may refuse; this is that
  // refusal, which the app must meet by saying so (apps/tech/src/store/persist.ts).
  await page.addInitScript(() => {
    const storage = navigator.storage as { persist?: () => Promise<boolean> } | undefined;
    if (storage !== undefined) storage.persist = () => Promise.resolve(false);
  });
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);

  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();

  await expect(page.getByText("This phone has not promised to keep unsent work")).toBeVisible();
  const onToday = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(onToday.violations.map((violation) => violation.id)).toEqual([]);

  // And the queue itself names how long the work has been on the phone alone.
  await page.getByRole("link", { name: /1 action waiting/ }).click();
  await expect(page.getByText("This phone has not promised to keep unsent work")).toBeVisible();
  await expect(page.getByText(/^Waiting since /)).toBeVisible();

  const onWaiting = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(onWaiting.violations.map((violation) => violation.id)).toEqual([]);
});

test("says nothing about keeping the queue when the phone has promised to", async ({ page, context }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage as { persist?: () => Promise<boolean> } | undefined;
    if (storage !== undefined) storage.persist = () => Promise.resolve(true);
  });
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);

  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();

  await expect(page.getByRole("link", { name: /1 action waiting/ })).toBeVisible();
  await expect(page.getByText("This phone has not promised to keep unsent work")).toHaveCount(0);
});

test("accounts plainly for what has not reached us, and says what changed on a supersede", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);

  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();

  // Today says what is waiting, without a number of bytes or a spinner. Every
  // move here is a link inside the app: with no signal there is no navigation.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("link", { name: /1 action waiting/ })).toBeVisible();
  await page.getByRole("link", { name: /1 action waiting/ }).click();
  await expect(page.getByRole("heading", { name: "Waiting to reach us" })).toBeVisible();
  await expect(page.getByText("Rohit M.")).toBeVisible();

  // Ops moved the job while the phone was in the basement. The replay meets a
  // 409, and the screen says which field moved, never a generic error.
  fake.supersede = ["technician"];
  fake.online = true;
  await context.setOffline(false);

  await expect(page.getByText("This job is someone else's now.")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // Read and dealt with: the job's queue goes, and nothing is left waiting.
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 0 });
});

test("asks before a sign-out would lose unsent work, sends it first if asked, and signs nobody out without signal", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();

  // The signal goes, though the phone still believes it has a network, and the job starts anyway.
  fake.online = false;
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("link", { name: /1 action waiting/ })).toBeVisible();

  // One tap on Sign out no longer wipes the phone: it says what would be lost.
  const account = page.getByRole("button", { name: /Sign out$/ });
  await account.click();
  await expect(page.getByText("1 action not sent yet")).toBeVisible();
  await expect(page.getByText("Signing out deletes them from this phone, and they never reach us.")).toBeVisible();
  const asking = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);

  // With no signal the API cannot end the session, so the phone wipes nothing and says so.
  await page.getByRole("button", { name: "Sign out anyway" }).click();
  await expect(page.getByText(/^No signal, so you are still signed in and nothing was deleted/)).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });

  // Signal again: send first, and only then sign out, with nothing left to lose.
  fake.online = true;
  await account.click();
  await page.getByRole("button", { name: "Send first" }).click();
  await expect(page.getByRole("link", { name: /action waiting/ })).toHaveCount(0);
  expect(fake.writes.at(-1)?.path).toBe(`/api/tech/jobs/${JOB_ID}/start`);
  await account.click();
  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
});

// The offline outbox: what the technician does in a basement is held on the
// phone and replayed in order when the signal returns, and a job that FSM
// changed underneath says what changed rather than a generic error.

import type { Page } from "@playwright/test";
import { LOCAL_LOGIN_CODE } from "../../scripts/lib/local-stack.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { atTheDoor, fakeTech, heldOnPhone, JOB_ID, keptOnPhone, todayInIndia, type Fake } from "./fixtures.ts";

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
  // The check-in was made with signal: it has left the phone before the signal goes. Start job shows as soon as
  // the phone records the check-in, which can be before its write lands, and a run under load then held two.
  await expect.poll(async () => (await heldOnPhone(page)).outbox).toBe(0);

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

/** Takes the five angles of the set the capture screen is on, from the first still to take, and finishes it. */
async function photograph(page: Page, from = 1): Promise<void> {
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  for (let angle = from; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();
}

/** A service visit worked from Start job to the outcome, as the technician does it. */
async function workTheJob(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start job" }).click();
  await photograph(page);
  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
  for (const item of await page.getByRole("listitem").getByRole("button").all()) await item.click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Consumables used" })).toBeVisible();
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
  await photograph(page);
  await expect(page.getByRole("heading", { level: 1, name: "Outcome" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
}

// A whole job worked with no signal, from Start job to the outcome, reaches the API in the order it was
// done once the signal returns, each write once, with the photographs behind it.
test("replays a whole job worked with no signal, in the order it was done, once the signal returns", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);
  await workTheJob(page);

  // All of it is on the phone, and none of it has reached the API but the check-in made before the basement.
  const sentBefore = fake.writes.map((write) => write.path);
  expect(sentBefore).toEqual([`/api/tech/jobs/${JOB_ID}/checkin`]);
  // The outcome is queued as the screen moves on, so the count is waited for, not read the instant Next is tapped.
  await expect.poll(() => heldOnPhone(page)).toMatchObject({ outbox: 6, frames: 10 });

  fake.online = true;
  await context.setOffline(false);
  await expect.poll(async () => (await heldOnPhone(page)).outbox, { timeout: 30_000 }).toBe(0);

  const sent = fake.writes.map((write) => write.path.replace(`/api/tech/jobs/${JOB_ID}`, ""));
  expect(sent).toEqual(["/checkin", "/start", "/photos", "/checklist", "/consumables", "/photos", "/outcome"]);
  expect(new Set(fake.writes.map((write) => write.eventId)).size).toBe(fake.writes.length);
  await expect.poll(() => fake.photos.length, { timeout: 30_000 }).toBe(10);
  expect(fake.progress.outcome).toBe("done");
});

// A refused set could not be retaken, and the only way out deleted the whole job's work.
test("a photograph the API refused is taken again on a job closed on the phone, and the rest of the job follows", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  fake.refusedPhoto = "before-top";
  await intoTheBasement(page, context, fake);
  await workTheJob(page);
  await expect.poll(() => heldOnPhone(page)).toMatchObject({ outbox: 6, frames: 10 });

  // Back on signal: the other four before photographs go up, and the set and what follows it wait.
  fake.online = true;
  await context.setOffline(false);
  const stopped = page.getByRole("alert").filter({ hasText: "The photos wouldn’t upload." });
  await expect(stopped).toBeVisible({ timeout: 30_000 });
  expect(fake.photos.filter((slot) => slot.startsWith("before-"))).toHaveLength(4);
  expect(fake.writes.map((write) => write.path.split("/").at(-1))).toEqual(["checkin", "start"]);

  await stopped.getByRole("link", { name: "See what is waiting" }).click();
  await expect(page.getByText("Before photos · 4 of 5 sent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete this job's work" })).toBeVisible();
  await page.getByRole("button", { name: "Retake photos" }).click();

  // Only the refused angle is asked for: the four that reached us count.
  await expect(page.getByRole("heading", { level: 1, name: "Before photos" })).toBeVisible();
  await expect(page.getByText("The top photo wouldn’t upload. Take it again.")).toBeVisible();
  await expect(page.getByText("4 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retake" })).toBeDisabled();
  fake.refusedPhoto = null;
  await photograph(page, 5);

  await expect.poll(async () => (await heldOnPhone(page)).outbox, { timeout: 30_000 }).toBe(0);
  const sent = fake.writes.map((write) => write.path.replace(`/api/tech/jobs/${JOB_ID}`, ""));
  expect(sent).toEqual(["/checkin", "/start", "/photos", "/checklist", "/consumables", "/photos", "/outcome"]);
  await expect.poll(() => fake.photos.length, { timeout: 30_000 }).toBe(10);
  expect(fake.photos).toContain("before-top");
  expect(await heldOnPhone(page)).toMatchObject({ frames: 0 });
});

// A technician ops switch off keeps the work his phone has not sent, for him alone, and the clients' cards go.
test("keeps a switched-off technician's unsent step, and sends it once he is back on and signs in", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);
  const already = fake.writes.length;
  await page.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Before photos")).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });

  // Ops switch him off while he is underground, and the phone hears it as the signal returns.
  fake.switchedOff = true;
  fake.online = true;
  await context.setOffline(false);

  await expect(page.getByRole("heading", { level: 1, name: "Technician sign in" })).toBeVisible();
  await expect(page.getByText(/Work not yet sent stays on this phone for 7 days/)).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 1 });
  // What the check-in measured, and the start it saw, stay with the work; the clients' cards go.
  const withTheWork = (key: string) => key.startsWith("arrivals:") || key.startsWith("starts:");
  expect((await keptOnPhone(page)).filter((key) => !withTheWork(key))).toEqual([]);

  fake.switchedOff = false;
  fake.signedIn = false;
  await page.getByRole("textbox", { name: "Mobile number" }).fill("9811000000");
  await page.getByRole("button", { name: "Send the code" }).click();
  await page.getByRole("textbox", { name: "Code" }).fill(LOCAL_LOGIN_CODE);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => fake.writes.length, { timeout: 15_000 }).toBe(already + 1);
  expect(fake.writes.at(-1)?.path).toBe(`/api/tech/jobs/${JOB_ID}/start`);
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

  await expect(page.getByText("Unsent work could be lost")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // And the queue itself names how long the work has been on the phone alone.
  await page.getByRole("link", { name: /1 action waiting/ }).click();
  await expect(page.getByText("Unsent work could be lost")).toBeVisible();
  await expect(page.getByText(/^Waiting since /)).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
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
  await expect(page.getByText("Unsent work could be lost")).toHaveCount(0);
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

  // Ops gave the job to Sameer at 10:40 while the phone was in the basement.
  // The replay meets a 409, and the screen says whom it went to and when, by
  // first name, never a generic error (open point 92).
  fake.supersede = ["technician"];
  fake.wentTo = { technician: "Sameer", at: `${todayInIndia()}T05:10:00.000Z` };
  fake.online = true;
  await context.setOffline(false);

  const movedToSameer = "Ops moved this job to Sameer at 10:40 am.";
  await expect(page.getByText(movedToSameer).first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // Not only here: every screen says so, and the card offers nothing to press on with.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: `9:30 am service · Sector 65: ${movedToSameer}` }),
  ).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "Rohit M." }).click();
  await expect(page.getByRole("heading", { level: 2, name: "This job changed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
  const changed = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "This job changed" }) });
  await expect(changed).toContainText(movedToSameer);
  await page.goto(`/jobs/${JOB_ID}/before-photos`);
  await expect(page.getByRole("alert").filter({ hasText: movedToSameer })).toBeVisible();

  // Read and dealt with: the job's queue goes, and nothing is left waiting.
  await page.goto("/waiting");
  await page.getByRole("button", { name: "Delete this job's work" }).click();
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ outbox: 0 });
  await expect(page.getByRole("alert").filter({ hasText: movedToSameer })).toHaveCount(0);
});

// Which job moved, by the time the technician knew, and the time it moved to from the card read again.
test("says which job moved to another time, and to when", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByRole("button", { name: "Start job" })).toBeVisible();
  await expect.poll(() => fake.writes.length).toBe(1);

  // Ops move the 9:30 visit an hour on, and the phone's write still carries the old time.
  fake.movedTo = new Date(Date.parse(fake.writes[0]?.startsAt ?? "") + 3_600_000).toISOString();
  await page.getByRole("button", { name: "Start job" }).click();

  // Start job has gone on to the before photos, where the banner says it.
  const movedLine = "Ops moved this job to 10:30 am today.";
  await expect(page.getByRole("alert").filter({ hasText: `9:30 am service · Sector 65: ${movedLine}` })).toBeVisible();

  await page.goto(`/jobs/${JOB_ID}`);
  const changed = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "This job changed" }) });
  await expect(changed).toContainText(movedLine);
});

test("a job ops gave away while its photographs waited says whom to, and asks before deleting them", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();
  await page.getByRole("button", { name: "Start job" }).click();
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  await expect.poll(() => fake.writes.length).toBe(2);

  // Underground for the before set.
  fake.online = false;
  await context.setOffline(true);
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();

  // Nothing has gone up, and the queue says so: no bar full of frames that are only waiting.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: /photo set waiting/ }).click();
  await expect(page.getByText("No signal · working offline")).toBeVisible();
  await expect(page.getByText("Before photos · 0 of 5 sent")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);

  // Ops gave the job to Sameer at 10:40 while the phone was underground. The
  // photographs' link says whom it went to, as a refused write does (open point 92).
  fake.moved = true;
  fake.wentTo = { technician: "Sameer", at: `${todayInIndia()}T05:10:00.000Z` };
  fake.online = true;
  await context.setOffline(false);

  await expect(page.getByText("Ops moved this job to Sameer at 10:40 am.").first()).toBeVisible();
  await expect(page.getByText(/would not upload|no longer on your list/)).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  // Deleting never throws away photographs on one tap, and the question opens on the safe answer.
  await page.getByRole("button", { name: "Delete this job's work" }).click();
  await expect(page.getByText("This deletes 5 photos and 1 action from this phone.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep them" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await heldOnPhone(page)).toMatchObject({ frames: 5 });

  await page.getByRole("button", { name: "Delete this job's work" }).click();
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(page.getByText("Everything has reached us.")).toBeVisible();
  expect(await heldOnPhone(page)).toMatchObject({ frames: 0, outbox: 0 });
});

test("counts a set as sent only as its photographs go up", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await intoTheBasement(page, context, fake);
  await page.getByRole("button", { name: "Start job" }).click();
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();
  // Every move here is a link inside the app: with no signal there is no navigation.
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("link", { name: /photo set waiting/ }).click();

  await expect(page.getByText("Before photos · 0 of 5 sent")).toBeVisible();
  const width = await page.locator("[data-bar] > div").evaluate((bar) => bar.getBoundingClientRect().width);
  expect(width).toBe(0);

  fake.online = true;
  await context.setOffline(false);
  await expect(page.getByText("Everything has reached us.")).toBeVisible({ timeout: 15_000 });
  expect(fake.photos).toHaveLength(5);
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
  expect(await axeViolations(page)).toEqual([]);

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

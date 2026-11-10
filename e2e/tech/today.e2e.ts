// Today, in the new look: the next job with the way there, the rest of the day, tomorrow, the empty day, the no-signal
// bar, and one job's card with its locked version.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { card, JOB_ID, NOTHING_DONE, ROHITS_PIECE, todayInIndia } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { keptOnPhone, leftOnPhone } from "./on-phone.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

/** The rest of the day, under Later today. */
const laterRows = (page: Page) => page.getByRole("region", { name: techCopy.today.later }).getByRole("listitem");

/** The next job's block. */
const nextJob = (page: Page) => page.getByRole("region", { name: /^Next|^At the door|^In progress/ });

test("puts the next job first with the way there, then the rest of the day, with no amount anywhere", async ({
  page,
}) => {
  await fakeTech(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText(techCopy.today.sync.synced)).toBeVisible();

  // The next job: when to leave, the time and length, the client, the visit and how it is paid, and the drive.
  const next = nextJob(page);
  await expect(next).toContainText(/^Next · leave/);
  await expect(next.getByText("9:30 am", { exact: true })).toBeVisible();
  await expect(next.getByText("1 h 30 min", { exact: true })).toBeVisible();
  await expect(next).toContainText("Rohit M.");
  await expect(next).toContainText("Service visit · prepaid");
  await expect(next).toContainText(`Tower C, 14th floor, Sector 65 · ${techCopy.today.driveTo(18)}`);
  await expect(next.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=28.39%2C77.07",
  );
  // Message and Call, once the card the phone keeps names the client's number.
  await expect(next.getByRole("link", { name: techCopy.today.call("Rohit") })).toHaveAttribute("href", /^tel:/);
  await expect(next.getByRole("link", { name: techCopy.today.message("Rohit") })).toBeVisible();

  // The rest of the day: each with its drive and when to leave, the locked one by its kind.
  const rows = laterRows(page);
  await expect(rows.first()).toContainText("Vikram S.");
  await expect(rows.first()).toContainText(`Service visit · DLF Phase 4 · ${techCopy.badgesLower.credit}`);
  await expect(rows.first()).toContainText(techCopy.today.driveAndLeave(20, "11:10 am"));
  await expect(rows.nth(1).getByText("2 pm", { exact: true })).toBeVisible();
  await expect(rows.nth(1).getByText("3 h", { exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText(techCopy.today.driveAndLeave(25, "1:35 pm"));

  // "No money anywhere in the technician app": a badge only.
  await expect(page.locator("body")).not.toContainText("₹");
  expect(await axeViolations(page)).toEqual([]);
});

test("a job closed out on another phone is done with on Today, and the next is the one after", async ({ page }) => {
  const fake = await fakeTech(page);
  // The visit's status still says scheduled, and this phone holds none of the job's work.
  fake.progress = {
    ...NOTHING_DONE,
    checked_in_at: new Date(Date.now() - 90 * 60_000).toISOString(),
    started_at: new Date(Date.now() - 80 * 60_000).toISOString(),
    steps_done: ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
    outcome: "partial",
  };
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "2 jobs today" })).toBeVisible();
  await expect(nextJob(page)).toContainText("Vikram S.");
  const closed = laterRows(page).first();
  await expect(closed).toContainText(techCopy.today.closed.partial);
  await closed.click();
  await expect(page.getByText("Closed out · partly done")).toBeVisible();
});

test("says when a job under way runs into the next", async ({ page }) => {
  const fake = await fakeTech(page);
  // Begun at 10 am, the 90-minute visit runs to 11:30, past the 11 o'clock it must be done by for Vikram's.
  const begun = `${todayInIndia()}T04:30:00.000Z`;
  fake.progress = { ...NOTHING_DONE, checked_in_at: begun, started_at: begun, steps_done: ["before_photos"] };
  await page.goto("/");
  await expect(nextJob(page)).toContainText(techCopy.today.next.inProgress);
  await expect(nextJob(page)).toContainText(techCopy.today.runsOver("11 am", "11:30 am"));
});

test("says there are no jobs when the day is empty", async ({ page }) => {
  await fakeTech(page, true);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: techCopy.today.noJobs })).toBeVisible();
  await expect(page.getByText(techCopy.today.noMore)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the no-signal bar with no signal, and the card still opens from the phone", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // The card is opened once with signal, so the phone is holding it.
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await page.getByRole("button", { name: techCopy.queue.back }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();

  // Into a basement. The app is already open, as it is on a technician's phone.
  fake.online = false;
  await context.setOffline(true);

  await expect(page.getByText(techCopy.today.offline.bar)).toBeVisible();
  await expect(page.getByText(techCopy.today.sync.offline(0))).toBeVisible();
  await expect(page.getByText("Rohit M.").first()).toBeVisible();

  // The card comes from what the phone kept, not from the API, which cannot be reached.
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
});

test("says there is no signal when nothing answers, even while the phone says it has a network", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText(techCopy.today.offline.bar)).toHaveCount(0);

  // A weak signal: the phone reports a network, and nothing on it answers.
  fake.online = false;
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await page.getByRole("button", { name: techCopy.queue.back }).click();
  await expect(page.getByText(techCopy.today.offline.bar)).toBeVisible();

  // And once something answers again, it stops saying so.
  fake.online = true;
  await page.getByText("Rohit M.").first().click();
  await page.getByRole("button", { name: techCopy.queue.back }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText(techCopy.today.offline.bar)).toHaveCount(0);
});

test("keeps today’s and tomorrow’s jobs and lets go of every older day and card as the day arrives", async ({
  page,
}) => {
  await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect.poll(() => keptOnPhone(page)).toContain(`cards:${JOB_ID}`);

  // What a week-old day left behind: its list, a client's card and what the check-in measured.
  const old = "a0000000-0000-4000-8000-00000000000f";
  await leftOnPhone(page, {
    days: [{ date: "2020-01-01", jobs: [] }],
    cards: [{ ...card("2020-01-01", NOTHING_DONE), id: old }],
    arrivals: [{ job_id: old, arrival: { passed: true } }],
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect.poll(() => keptOnPhone(page)).not.toContain(`cards:${old}`);
  const kept = await keptOnPhone(page);
  expect(kept).not.toContain("days:2020-01-01");
  expect(kept).not.toContain(`arrivals:${old}`);
  expect(kept).toContain(`days:${todayInIndia()}`);
  expect(kept).toContain(`cards:${JOB_ID}`);
});

test("opens a job’s card with its address, access notes and the way in (board A3)", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByText("Rohit M.").first().click();

  await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeVisible();
  await expect(page.getByText("9:30–10 am · service")).toBeVisible();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await expect(page.getByText("Gate code 4417 · visitor bay B")).toBeVisible();
  // A Maps URL now, not `geo:`, which an iPhone ignores (ADR 0054; e2e/tech/job.e2e.ts).
  await expect(page.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute(
    "href",
    /^https:\/\/www\.google\.com\/maps\/dir\//,
  );
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toBeVisible();

  expect(await axeViolations(page)).toEqual([]);
});

test("a job further out shows time, type and sector only, and cannot be started", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await laterRows(page).nth(1).click();

  // When it opens, from the card's unlocks_at, not "the day before".
  await expect(page.getByText("Opens at 6 pm tomorrow.")).toBeVisible();
  await expect(page.getByText("Sector 43")).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.job.start })).toHaveCount(0);
});

test("scrolls the whole day on a screen shorter than it, down to tomorrow, above the tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "3 jobs today" })).toBeVisible();

  const tomorrow = page.getByRole("link", { name: /^Tomorrow · 1 job from/ });
  await expect(tomorrow).not.toBeInViewport({ ratio: 1 });
  // A finger's scroll, not a script's: a column that hid what overflows it would leave tomorrow out of reach.
  await page.mouse.move(180, 240);
  await expect(async () => {
    await page.mouse.wheel(0, 200);
    await expect(tomorrow).toBeInViewport({ ratio: 1, timeout: 200 });
  }).toPass();
  // At the very foot of the day, clear of the tab bar, which stays at the foot of the window.
  await page.mouse.wheel(0, 3000);
  await expect(tomorrow).toBeInViewport({ ratio: 1 });
  const bar = await page.getByRole("navigation", { name: techCopy.tabs.label }).boundingBox();
  const row = await tomorrow.boundingBox();
  expect((row?.y ?? 0) + (row?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
});

test("every target on every screen is at least the design’s 48 px, and the primary action is 64", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  fake.pieces = [ROHITS_PIECE];
  await page.goto(`/jobs/${JOB_ID}`);
  const arrive = page.getByRole("button", { name: techCopy.notHome.arrived.action });
  await expect(arrive).toBeVisible();

  const box = await arrive.boundingBox();
  expect(box?.height).toBe(64);
  expect(Math.round(box?.width ?? 0)).toBe(390 - 40);

  // "Nothing under 48 px", on Today, the card, the queue and each of the steps.
  fake.progress = {
    ...fake.progress,
    checked_in_at: "2030-01-01T04:00:00.000Z",
    started_at: "2030-01-01T04:10:00.000Z",
  };
  const screens = [
    "/",
    "/me",
    `/jobs/${JOB_ID}`,
    "/waiting",
    "before-photos",
    "checklist",
    "consumables",
    "piece",
    "outcome",
  ];
  for (const screen of screens) {
    await page.goto(screen.startsWith("/") ? screen : `/jobs/${JOB_ID}/${screen}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const target of await page.locator("button, a[href], input").all()) {
      if (!(await target.isVisible())) continue;
      const each = await target.boundingBox();
      const name = `${screen}: ${(await target.textContent()) ?? ""}${(await target.getAttribute("aria-label")) ?? ""}`;
      expect(each?.height ?? 0, name).toBeGreaterThanOrEqual(48);
      expect(each?.width ?? 0, name).toBeGreaterThanOrEqual(48);
    }
  }
});

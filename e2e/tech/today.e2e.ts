// Boards A1, A2 and A3: the day's jobs, the empty state, the offline banner,
// and one job's card with its locked version.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import {
  card,
  fakeTech,
  JOB_ID,
  keptOnPhone,
  leftOnPhone,
  NOTHING_DONE,
  ROHITS_PIECE,
  todayInIndia,
} from "./fixtures.ts";

test("lists the day's jobs in order, with no amount anywhere (board A1)", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText("First at 9:30 am · Sector 65")).toBeVisible();

  const rows = page.getByRole("listitem");
  // The day's list names the client of a job that has unlocked.
  await expect(rows.first()).toContainText("Rohit M.");
  await expect(rows.nth(1)).toContainText("Vikram S.");
  await expect(rows.first()).toContainText("Sector 65");
  await expect(rows.first()).toContainText("Prepaid");
  await expect(rows.nth(1)).toContainText("Credit");
  // The clock the heading uses, never "2:00", and how long each visit is, never "2 slots".
  await expect(rows.first().getByText("9:30 am", { exact: true })).toBeVisible();
  await expect(rows.first().getByText("90 min", { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("2 pm", { exact: true })).toBeVisible();
  await expect(rows.nth(2).getByText("180 min", { exact: true })).toBeVisible();

  // "No money anywhere in the technician app": a badge only.
  await expect(page.locator("body")).not.toContainText("₹");
  expect(await axeViolations(page)).toEqual([]);
});

// "CONSULTATION AND FIT · PAYS ONCE FITTED" broke into two ragged columns at 375 and 390 px.
test("keeps a row's type and its badge each on one line on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const fake = await fakeTech(page);
  fake.type = "first_fit";
  fake.oneVisit = true;
  await page.goto("/");

  const row = page.getByRole("listitem").first();
  for (const words of ["Consultation and fit", "Pays once fitted"]) {
    const lines = await row.getByText(words).evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    });
    expect(lines, words).toBe(1);
  }
});

test("a job closed out on another phone reads as closed on Today, as its card says", async ({ page }) => {
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

  const row = page.getByRole("listitem").first();
  await expect(row).toContainText("Closed out");
  await row.click();
  await expect(page.getByText("Closed out · partial")).toBeVisible();
});

test("says nothing is booked when the day is empty (board A2)", async ({ page }) => {
  await fakeTech(page, true);
  await page.goto("/");
  await expect(page.getByText("Nothing booked for today")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
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
    page.getByText("Today’s jobs and cards are on the phone. Photos go up when signal returns."),
  ).toBeVisible();
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
  await expect(page.getByText("No signal · working offline")).toHaveCount(0);

  // A weak signal: the phone reports a network, and nothing on it answers.
  fake.online = false;
  await page.getByText("Rohit M.").first().click();
  await expect(page.getByText("Tower C, 14th floor, Sector 65, Gurgaon 122018")).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByText("No signal · working offline")).toBeVisible();

  // And once something answers again, it stops saying so.
  fake.online = true;
  await page.getByText("Rohit M.").first().click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByText("No signal · working offline")).toHaveCount(0);
});

test("keeps today's and tomorrow's jobs and lets go of every older day and card as the day arrives", async ({
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

  expect(await axeViolations(page)).toEqual([]);
});

test("a job further out shows time, type and sector only, and cannot be started", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByRole("listitem").nth(2).click();

  // When it opens, from the card's unlocks_at, not "the day before".
  await expect(page.getByText("Opens at 6 pm tomorrow.")).toBeVisible();
  await expect(page.getByText("Sector 43")).toBeVisible();
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
});

test("scrolls the whole day on a screen shorter than it, down to tomorrow's last job", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 480 });
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "3 jobs today" })).toBeVisible();
  await page.getByRole("button", { name: "Tomorrow · 1 job" }).click();

  const last = page.getByRole("listitem").last();
  await expect(last).toContainText("Sector 50");
  await expect(last).not.toBeInViewport({ ratio: 1 });

  // A finger's scroll, not a script's: a column that hid what overflows it would leave this job out of reach.
  await page.mouse.move(180, 240);
  await page.mouse.wheel(0, 1000);
  await expect(last).toBeInViewport({ ratio: 1 });
});

test("every target on every screen is at least the design's 48 px, and the primary action is 64", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "replacement";
  fake.pieces = [ROHITS_PIECE];
  await page.goto(`/jobs/${JOB_ID}`);
  const arrive = page.getByRole("button", { name: "I have arrived" });
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
  const screens = ["/", `/jobs/${JOB_ID}`, "/waiting", "before-photos", "checklist", "consumables", "piece", "outcome"];
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

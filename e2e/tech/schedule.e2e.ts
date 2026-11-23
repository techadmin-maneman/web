// Schedule (docs/prompts/tech-redesign.md, "Schedule"): today and the six days after it as a strip, the day chosen down
// the hours with each job and the drive before it; a later job opens a read-only preview, and a job today opens its
// card, whose way back is Schedule. A step back shows the seven days before, and on again comes back to this week.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { dayAfter, JOB_ID, jobsTomorrow, todayInIndia, TOMORROW_JOB_ID } from "./fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { tab } from "./tabs.ts";

const copy = techCopy.schedule;

test("opens today and the six days after it, today down the hours with the drive before each job", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.schedule).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: copy.title }).getByRole("radio")).toHaveCount(7);
  await expect(page.getByRole("table", { name: copy.dayView })).toBeVisible();
  // Only today is named, as the prototype writes it: "Today, Thu 12 Nov".
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(
    /^Today, [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/,
  );
  await expect(page.getByText(/^18 min · leave \d{1,2}(:\d{2})? [ap]m$/)).toBeVisible();
  await expect(page.locator(`a[href="/jobs/${JOB_ID}"]`)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

// A job was a link as tall as its words, 35 px of a 90-minute block, and a short one shorter still.
test("opens a job from anywhere on its block, a short one from a thumb's 44 px, its drive above it", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.firstMinutes = 30;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await tab(page, techCopy.tabs.schedule).click();
  const job = page.locator(`a[href="/jobs/${JOB_ID}"]`);
  const block = await job.locator("..").boundingBox();
  const middle = (block?.x ?? 0) + (block?.width ?? 0) / 2;
  const top = block?.y ?? 0;
  const opens = await page.evaluate(
    ({ x, y }) => [y + 2, y + 42].map((at) => document.elementFromPoint(x, at)?.closest("a")?.getAttribute("href")),
    { x: middle, y: top },
  );
  expect(opens).toEqual([`/jobs/${JOB_ID}`, `/jobs/${JOB_ID}`]);
  // The drive's line ends where the visit begins.
  const drive = await page.getByText(/^18 min · leave /).boundingBox();
  expect((drive?.y ?? 0) + (drive?.height ?? 0)).toBeLessThanOrEqual(top + 1);
});

test("opens tomorrow's job, its card open since 6 pm, from Schedule, and goes back to that day", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  const tomorrow = dayAfter(todayInIndia());
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(`^${techCopy.today.tomorrow}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
  // Any other day plainly: "Fri, 13 Nov".
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2}$/);
  await page.locator(`a[href="/jobs/${TOMORROW_JOB_ID}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${TOMORROW_JOB_ID}$`));
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
});

test("opens a later job still locked as a preview, which says when its card opens", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  const tomorrow = dayAfter(todayInIndia());
  const locked = jobsTomorrow(todayInIndia()).map((job) => ({ ...job, unlocked: false }));
  // Registered after the fake, so it answers first: tomorrow's job before its card opens.
  await page.route(`**/api/tech/jobs?date=${tomorrow}`, (route) =>
    route.fulfill({ json: { date: tomorrow, jobs: locked, settled: true, sent_back: [] } }),
  );
  await page.goto(`/week/${tomorrow}`);
  await page.locator(`a[href="/week/${tomorrow}/${TOMORROW_JOB_ID}"]`).click();
  await expect(page.getByText(copy.preview.time)).toBeVisible();
  await expect(page.getByText(copy.preview.payment)).toBeVisible();
  await expect(page.getByText(/^Name and address from /)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
});

test("with no signal shows the days the phone keeps, says the rest didn't load, and reads them all once back", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  // The rest of the app is fetched once the first screen has drawn, as a phone fetches it in its first seconds.
  await page.waitForLoadState("networkidle");
  fake.online = false;
  await context.setOffline(true);
  await tab(page, techCopy.tabs.schedule).click();
  await expect(page.getByText(techCopy.today.offline.bar)).toBeVisible();
  await expect(page.getByRole("table", { name: copy.dayView })).toBeVisible();
  await page
    .getByRole("radio", { name: /^Saturday|^Sunday|^Monday|^Tuesday|^Wednesday|^Thursday|^Friday/ })
    .last()
    .check();
  await expect(page.getByText(copy.dayFailed)).toBeVisible();

  fake.online = true;
  await context.setOffline(false);
  await expect(page.getByText(copy.dayFailed)).toHaveCount(0);
  // Six days ahead, its visits are given out the evening before.
  await expect(page.getByText(copy.comeEveningBefore)).toBeVisible();
});

test("keeps the days it showed when it reads the week again with no signal", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await page.goto("/week");
  await page.getByRole("radio").last().check();
  await expect(page.getByText(copy.comeEveningBefore)).toBeVisible();
  let unanswered = 0;
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/tech/jobs?date=")) unanswered += 1;
  });
  fake.online = false;
  await context.setOffline(true);
  // The app back in front: the week is read again, and no day answers.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => unanswered).toBeGreaterThanOrEqual(7);
  // The read goes on to the phone's kept days once the calls fail; nothing on screen marks its end, so let it.
  await page.waitForTimeout(1000);
  await expect(page.getByText(copy.comeEveningBefore)).toBeVisible();
  await expect(page.getByText(copy.dayFailed)).toHaveCount(0);
});

// At 9:35 am in India, inside the fixture's 9:30 job, so the now-line crosses it: it was cut there once, its link left
// above the line under the part below, and the job could not be opened from Schedule while it was on.
test("a job on now opened from Schedule goes back to Schedule", async ({ page }) => {
  await page.clock.install({ time: new Date(`${todayInIndia()}T04:05:00.000Z`) });
  await fakeTech(page);
  await page.goto("/week");
  await page.locator(`a[href="/jobs/${JOB_ID}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/week$/);
});

/** The date `days` from `date`. */
const daysFrom = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

test("says a past week did not load, and still steps back on to this week", async ({ page }) => {
  await fakeTech(page);
  const today = todayInIndia();
  await page.route("**/api/tech/past-week?**", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "req-past-1" } } }),
  );
  await page.goto("/week");
  await page.getByRole("button", { name: copy.earlier }).click();
  await expect(page.getByText(copy.failed)).toBeVisible();
  // The week's span is known before it loads.
  const first = String(Number(daysFrom(today, -7).slice(8, 10)));
  await expect(page.getByText(new RegExp(`^${first}( [A-Z][a-z]{2})? to `))).toBeVisible();
  await page.getByRole("button", { name: copy.later }).click();
  await expect(page).toHaveURL(/\/week$/);
  await expect(page.getByRole("table", { name: copy.dayView })).toBeVisible();
});

// Back only (ADR 0298): a past week's jobs say how they closed and open nothing, and nothing of the client is asked for.
test("steps back to the week before, its jobs as they closed, and on again to this week, never past it", async ({
  page,
}) => {
  await fakeTech(page);
  const today = todayInIndia();
  const from = daysFrom(today, -7);
  const asked: string[] = [];
  // Registered after the fake, so it answers first.
  await page.route("**/api/tech/past-week?**", (route) => {
    const start = new URL(route.request().url()).searchParams.get("from") ?? "";
    asked.push(start);
    const days = Array.from({ length: 7 }, (_, at) => ({
      date: daysFrom(start, at),
      jobs:
        at === 2
          ? [
              {
                id: "22222222-2222-4222-8222-222222222231",
                starts_at: `${daysFrom(start, 2)}T05:30:00.000Z`,
                minutes: 90,
                type: "service",
                one_visit: false,
                status: "completed",
                progress: { started_at: null, outcome: null },
              },
            ]
          : [],
    }));
    return route.fulfill({ json: { from: start, days } });
  });
  await page.goto("/week");
  const later = page.getByRole("button", { name: copy.later });
  await expect(later).toBeDisabled();
  await page.getByRole("button", { name: copy.earlier }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${from}$`));
  await expect(page.getByRole("radiogroup", { name: copy.title }).getByRole("radio")).toHaveCount(7);
  await expect(page.getByText(copy.noneThen)).toBeVisible();
  await page.getByRole("radio").nth(2).check();
  await expect(page.getByText("Done · 1 h 30 min")).toBeVisible();
  await expect(page.locator('main a[href^="/jobs/"], main a[href^="/week/"]')).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);
  await later.click();
  await expect(page).toHaveURL(/\/week$/);
  await expect(later).toBeDisabled();
  // Only that week was asked for: each day chosen reads it again, as this week's days are read.
  expect(new Set(asked)).toEqual(new Set([from]));
});

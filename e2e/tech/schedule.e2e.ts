// Schedule (docs/prompts/tech-redesign.md, "Schedule"): today and the six days after it as a strip, the day chosen down
// the hours with each job and the drive before it; a later job opens a read-only preview, and a job today opens its
// card, whose way back is Schedule.

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
  await expect(page.getByText(/^18 min · leave \d{1,2}(:\d{2})? [ap]m$/)).toBeVisible();
  await expect(page.locator(`a[href="/jobs/${JOB_ID}"]`)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("opens tomorrow's job, its card open since 6 pm, from Schedule, and goes back to that day", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  const tomorrow = dayAfter(todayInIndia());
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(`^${techCopy.today.tomorrow}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
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
    route.fulfill({ json: { date: tomorrow, jobs: locked, sent_back: [] } }),
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
  await expect(page.getByText(copy.nothing)).toBeVisible();
});

test("keeps the days it showed when it reads the week again with no signal", async ({ page, context }) => {
  const fake = await fakeTech(page);
  await page.goto("/week");
  await page.getByRole("radio").last().check();
  await expect(page.getByText(copy.nothing)).toBeVisible();
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
  await expect(page.getByText(copy.nothing)).toBeVisible();
  await expect(page.getByText(copy.dayFailed)).toHaveCount(0);
});

test("a job today opened from Schedule goes back to Schedule", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/week");
  await page.locator(`a[href="/jobs/${JOB_ID}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/week$/);
});

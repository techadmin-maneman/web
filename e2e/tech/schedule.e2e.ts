// Schedule (docs/prompts/tech-redesign.md, "Schedule"): today and the six days after it as a strip, the day chosen down
// the hours with each job and the drive before it; a later job opens a read-only preview, and a job today opens its
// card, whose way back is Schedule.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { dayAfter, JOB_ID, todayInIndia, TOMORROW_JOB_ID } from "./fixtures.ts";
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

test("opens a later job's preview from tomorrow, and goes back to that day", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  const tomorrow = dayAfter(todayInIndia());
  await page.goto("/");
  await page.getByRole("link", { name: new RegExp(`^${techCopy.today.tomorrow}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
  await page.locator(`a[href="/week/${tomorrow}/${TOMORROW_JOB_ID}"]`).click();
  await expect(page.getByText(copy.preview.time)).toBeVisible();
  await expect(page.getByText(copy.preview.area)).toBeVisible();
  await expect(page.getByText(copy.preview.payment)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}$`));
});

test("a job today opened from Schedule goes back to Schedule", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/week");
  await page.locator(`a[href="/jobs/${JOB_ID}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/week$/);
});

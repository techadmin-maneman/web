// Guides, from Me (docs/prompts/tech-redesign.md, "Guides"): the four kinds of visit, each its steps in order and the
// tasks a step guides, every task read alone; drawn from what the phone holds, so it opens with no signal. A later
// job's preview opens its kind's guide.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { dayAfter, jobsTomorrow, todayInIndia, TOMORROW_JOB_ID } from "./fixtures.ts";
import { tab } from "./tabs.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.guides;

test("opens from Me, lists the four kinds of visit, and reads a task's instructions alone", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();
  await page.getByRole("link", { name: new RegExp(`^${copy.title}`) }).click();

  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  for (const name of Object.values(techCopy.types)) {
    await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: new RegExp(`^${techCopy.types.service}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.types.service })).toBeVisible();
  await expect(page.getByText(copy.what.before_photos)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: "Clean the scalp" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clean the scalp" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Wipe the bonding area with alcohol." })).toBeVisible();
  await expect(page.getByText(techCopy.visit.watchFor)).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/guides\/service$/);
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/me$/);
});

test("opens with no signal, from what the phone holds", async ({ page, context }) => {
  await fakeTech(page);
  await page.goto("/me");
  await expect(page.getByRole("heading", { level: 1, name: techCopy.me.title })).toBeVisible();
  await context.setOffline(true);

  await page.getByRole("link", { name: new RegExp(`^${copy.title}`) }).click();
  await page.getByRole("link", { name: new RegExp(`^${techCopy.types.first_fit}`) }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.types.first_fit })).toBeVisible();
  await expect(page.getByRole("link", { name: "Check the template" })).toBeVisible();
  await context.setOffline(false);
});

test("opens a later job's kind of visit from its preview, and goes back to the preview", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  const tomorrow = dayAfter(todayInIndia());
  const locked = jobsTomorrow(todayInIndia()).map((job) => ({ ...job, unlocked: false }));
  const type = locked.find((job) => job.id === TOMORROW_JOB_ID)?.type ?? "service";
  // Registered after the fake, so it answers first: tomorrow's job before its card opens.
  await page.route(`**/api/tech/jobs?date=${tomorrow}`, (route) =>
    route.fulfill({ json: { date: tomorrow, jobs: locked, sent_back: [] } }),
  );
  await page.goto(`/week/${tomorrow}`);
  await page.locator(`a[href="/week/${tomorrow}/${TOMORROW_JOB_ID}"]`).click();
  await page.getByRole("link", { name: new RegExp(`^${copy.howDone}`) }).click();

  await expect(page).toHaveURL(new RegExp(`/guides/${type}$`));
  await expect(page.getByRole("heading", { level: 1, name: techCopy.types[type] })).toBeVisible();
  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(new RegExp(`/week/${tomorrow}/${TOMORROW_JOB_ID}$`));
});

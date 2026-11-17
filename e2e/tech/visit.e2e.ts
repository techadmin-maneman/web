// The visit engine's plan and the photographs' Compare (docs/decisions/0244-the-visit-engine.md): each screen done,
// under way or to do, with the visit's time and when it should finish; and an angle laid over the last visit's
// photograph of it, or today's before one, where there is one.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { shots } from "./steps-fixtures.ts";

const plan = techCopy.visit.plan;

test("opens the visit's plan from the job once begun: each screen done, under way or to do", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.progress = {
    ...fake.progress,
    checked_in_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    steps_done: ["before_photos"],
  };
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("link", { name: techCopy.visit.allSteps }).click();

  // The client and the visit, and when it started, as the prototype heads the plan.
  await expect(
    page.getByRole("heading", { level: 1, name: techCopy.visit.whoAndWhat("Rohit M.", "service visit") }),
  ).toBeVisible();
  await expect(page.getByText(/^Started \d{1,2}(:\d{2})? [ap]m$/)).toBeVisible();
  await expect(page.getByText(plan.done(1, 5))).toBeVisible();
  await expect(page.getByText(/^Finish by /)).toBeVisible();
  // Each step with what it is, numbered while it waits; one done says so, and a step of tasks counts them.
  const rows = page.getByRole("list", { name: plan.title }).getByRole("listitem");
  const what = techCopy.guides.what;
  await expect(rows).toHaveText([
    `Before photos${plan.stepDone}`,
    `Service${plan.tasks(3)}`,
    `3Consumables${what.consumables}`,
    `4After photos${what.after_photos}`,
    `5Outcome${what.outcome}`,
  ]);
  // A screen done or under way opens; one to do waits its turn.
  await expect(rows.nth(1).getByRole("link")).toHaveCount(1);
  await expect(rows.nth(2).getByRole("link")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  // Continue opens the step under way.
  await page.getByRole("button", { name: plan.continue }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
});

test("compares the angle to take with the last visit's, over the top half of the view", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.compare = true;
  await page.goto(`/jobs/${JOB_ID}/before-photos`);

  const compare = page.getByRole("button", { name: techCopy.capture.compareWith.before });
  await expect(compare).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await expect(page.getByRole("img", { name: techCopy.capture.compareImage.before("Front") })).toBeHidden();
  await compare.click();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: techCopy.capture.compareImage.before("Front") })).toBeVisible();
});

test("offers no Compare where there is nothing to compare with", async ({ page }) => {
  await fakeTech(page);
  const answered = page.waitForResponse((response) => response.url().includes("/compare/before/front"));
  await page.goto(`/jobs/${JOB_ID}/before-photos`);
  expect((await answered).status()).toBe(404);
  await expect(page.getByRole("button", { name: techCopy.capture.take })).toBeEnabled();
  await expect(page.getByRole("button", { name: techCopy.capture.compareWith.before })).toHaveCount(0);
});

test("marks a step the API refused as needing a fix, in red on the plan", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.refusedPhoto = "before-front";
  fake.progress = {
    ...fake.progress,
    checked_in_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
  await page.goto(`/jobs/${JOB_ID}/before-photos`);
  const shutter = page.getByRole("button", { name: techCopy.capture.take });
  for (let angle = 1; angle <= 5; angle += 1) {
    await expect(shutter).toBeEnabled();
    await shutter.click();
    await expect(page.getByText(shots(angle), { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: techCopy.capture.finish }).click();
  // The set goes up: the API takes four photographs and refuses the front one.
  await expect.poll(() => fake.photos.length).toBe(4);

  await page.goto(`/jobs/${JOB_ID}/plan`);
  await expect(page.getByText(plan.needsFix).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("list", { name: plan.title }).getByRole("listitem").first()).toHaveText(
    new RegExp(`^Before photos\\s*${plan.needsFix}$`),
  );
  expect(await axeViolations(page)).toEqual([]);
});

test("says on the camera that there is no signal, and keeps taking photographs", async ({ page, context }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}/before-photos`);
  await expect(page.getByRole("button", { name: techCopy.capture.take })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText(techCopy.today.offline.bar)).toBeVisible();
  await page.getByRole("button", { name: techCopy.capture.take }).click();
  await expect(page.getByText(shots(1), { exact: true })).toBeVisible();
});

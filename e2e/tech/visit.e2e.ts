// The visit engine's plan and the photographs' Compare (docs/decisions/0244-the-visit-engine.md): each screen done,
// under way or to do, with the visit's time and when it should finish; and an angle laid over the last visit's
// photograph of it, or today's before one, where there is one.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

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

  await expect(page.getByRole("heading", { level: 1, name: plan.title })).toBeVisible();
  await expect(page.getByText(plan.done(1, 5))).toBeVisible();
  await expect(page.getByText(/^Finish by /)).toBeVisible();
  const rows = page.getByRole("list", { name: plan.title }).getByRole("listitem");
  await expect(rows).toHaveText([
    /^Before photos\s*Done$/,
    /^Service\s*Now$/,
    /^Consumables\s*To do$/,
    /^After photos\s*To do$/,
    /^Outcome\s*To do$/,
  ]);
  // A screen done or under way opens; one to do waits its turn.
  await expect(rows.nth(2).getByRole("link")).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await rows.nth(1).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
});

test("compares the angle to take with the last visit's, over the top half of the view", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.compare = true;
  await page.goto(`/jobs/${JOB_ID}/before-photos`);

  const compare = page.getByRole("button", { name: techCopy.capture.compareWith.before });
  await expect(compare).toBeVisible();
  await expect(page.getByRole("img", { name: techCopy.capture.compareImage.before("Front") })).toBeHidden();
  await compare.click();
  await expect(compare).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: techCopy.capture.compareImage.before("Front") })).toBeVisible();
});

test("offers no Compare where there is nothing to compare with", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}/before-photos`);
  await expect(page.getByRole("button", { name: techCopy.capture.take })).toBeEnabled();
  await expect(page.getByRole("button", { name: techCopy.capture.compareWith.before })).toHaveCount(0);
});

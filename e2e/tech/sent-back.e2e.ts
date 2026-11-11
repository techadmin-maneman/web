// A step ops sent back after the close (docs/decisions/0246-closed-and-sent-back.md): Today says so from whatever day,
// the job offers Put it right, the plan and the step say what ops want fixed, and sending it again closes it as before.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { startedThrough, stepAction, writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { today, job, visit, capture } = techCopy;

const ALL_DONE = ["before_photos", "checklist", "consumables", "after_photos", "outcome"] as const;

test("a count ops sent back is on Today, opens from the job, says why, and closes again once sent", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  startedThrough(fake, ...ALL_DONE);
  fake.progress = { ...fake.progress, outcome: "done" };
  fake.sentBack = [{ kind: "consumables", reason: "Count the tape strips again.", sent_at: new Date().toISOString() }];
  await page.goto("/");

  const card = page.getByText(today.toFixBody([today.toFixSteps.consumables]));
  await expect(card).toBeVisible();
  await card.click();

  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await page.getByRole("button", { name: job.putRight }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.consumables })).toBeVisible();
  await expect(page.getByText(visit.sentBack("Count the tape strips again."))).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await stepAction(page).click();
  await expect.poll(() => writesTo(fake, "consumables").length).toBe(1);
  // Nothing else is left to fix, so the visit is closed again.
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/done$`));
});

test("the visit's plan marks a step sent back as needing a fix, with what ops want fixed", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, ...ALL_DONE);
  fake.progress = { ...fake.progress, outcome: "done" };
  fake.sentBack = [{ kind: "checklist", reason: "Tick the scalp check.", sent_at: new Date().toISOString() }];
  await page.goto(`/jobs/${JOB_ID}/plan`);

  await expect(
    page.getByText(visit.plan.sentBack(visit.screens.service, "Tick the scalp check."), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(visit.screens.service) })).toContainText(visit.plan.needsFix);
});

test("a set of photographs ops sent back opens the camera again from its first angle, saying why", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, ...ALL_DONE);
  fake.progress = { ...fake.progress, outcome: "done" };
  fake.sentBack = [{ kind: "after_photos", reason: "The front is blurred.", sent_at: new Date().toISOString() }];
  await page.goto(`/jobs/${JOB_ID}/after-photos`);

  await expect(page.getByRole("alert").filter({ hasText: visit.sentBack("The front is blurred.") })).toBeVisible();
  await expect(page.getByText(capture.angles.front, { exact: false }).first()).toBeVisible();
});

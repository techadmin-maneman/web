// A job ops cancelled, or gave to another technician, under the phone (docs/decisions/0246-closed-and-sent-back.md):
// a dialog says so once over the screen, with a call to ops and the way back to Today.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { startedThrough, stepAction } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { interrupted } = techCopy;

test("a job ops cancelled under the phone says so once, with a call to ops and the way back to Today", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: techCopy.steps.checklist.all }).click();
  fake.supersede = ["status"];
  await stepAction(page).click();

  const dialog = page.getByRole("dialog", { name: /: cancelled$/ });
  await expect(dialog).toContainText(interrupted.cancelledBody);
  await expect(dialog.getByRole("link", { name: techCopy.ops.call })).toHaveAttribute("href", /^tel:\+/);
  expect(await axeViolations(page)).toEqual([]);

  await dialog.getByRole("button", { name: interrupted.today }).click();
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a job given to another technician names them", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: techCopy.steps.checklist.all }).click();
  fake.moved = true;
  fake.wentTo = { technician: "Sandeep", at: null };
  await stepAction(page).click();

  const dialog = page.getByRole("dialog", { name: /: moved to Sandeep$/ });
  await expect(dialog).toContainText(interrupted.movedBody("Sandeep"));
});

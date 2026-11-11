// Ask ops to reschedule, from the job (docs/decisions/0249-schedule-kit-and-me.md): a sheet with why, sent straight
// with signal, then a line on the card saying when and why, which the API keeps until ops settle it.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import { JOB_ID } from "./fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.reschedule;

test("asks ops to move the visit, with why, and says so on the card", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: copy.open }).click();
  const sheet = page.getByRole("dialog", { name: copy.open });
  await expect(sheet.getByRole("button", { name: copy.send })).toHaveCount(0);
  await sheet.getByRole("button", { name: copy.reasons.running_late }).click();
  // The way out sits on the sheet's dark ::backdrop, which axe cannot see: it would judge paper's words on paper.
  expect(await axeViolations(page, (axe) => axe.exclude("dialog > button"))).toEqual([]);
  await sheet.getByRole("button", { name: copy.send }).click();

  await expect(page.getByRole("status").filter({ hasText: copy.reasons.running_late })).toContainText(
    "ops will confirm with the client",
  );
  expect(fake.writes.find((write) => write.path.endsWith("/reschedule-request"))?.body).toEqual({
    reason: "running_late",
  });
  await expect(page.getByRole("button", { name: copy.open })).toHaveCount(0);
});

test("shows an ask already open on the card, and offers no other", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.rescheduleAsked = { asked_at: new Date().toISOString(), reason: "client_asked" };
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("status").filter({ hasText: copy.reasons.client_asked })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.open })).toHaveCount(0);
});

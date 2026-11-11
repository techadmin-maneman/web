// Closed (docs/decisions/0246-closed-and-sent-back.md): the heading by result, a one visit's payment link texted again
// from it, and a visit left partly done asking ops for a time to finish.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { startedThrough, writesTo } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { closeOut } = techCopy;

test("a one visit's unpaid link is texted again from the close", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.oneVisit = true;
  fake.clientChoice = { product: "natural" };
  fake.paymentLink = { url: "https://rzp.io/i/made", paid: false };
  startedThrough(fake, "before_photos", "profile", "piece", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  const link = page.getByRole("region", { name: closeOut.payment.title });
  await expect(link).toContainText(closeOut.payment.notPaid);
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.said.resent);
  expect(writesTo(fake, "resend")).toHaveLength(1);
  expect(await axeViolations(page)).toEqual([]);
});

test("a visit left partly done asks ops for a time to finish it", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "partial" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  const finish = page.getByRole("region", { name: closeOut.finish.title });
  await finish.getByRole("button", { name: closeOut.finish.asks.tomorrow_morning }).click();
  await expect(finish.getByRole("status")).toHaveText(closeOut.finish.sent);
  await expect(finish.getByRole("button", { name: closeOut.finish.asks.tomorrow_morning })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(writesTo(fake, "finish-ask").at(-1)?.body).toEqual({ ask: "tomorrow_morning" });
  expect(await axeViolations(page)).toEqual([]);
});

test("a visit closed done asks nothing of the kind", async ({ page }) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);

  await expect(page.getByRole("heading", { level: 1, name: closeOut.titles.closed })).toBeVisible();
  await expect(page.getByRole("region", { name: closeOut.finish.title })).toHaveCount(0);
  await expect(page.getByRole("region", { name: closeOut.payment.title })).toHaveCount(0);
});

test("Resend says when the link has been texted as often as today allows, and when there is no signal", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.oneVisit = true;
  fake.clientChoice = { product: "natural" };
  fake.paymentLink = { url: "https://rzp.io/i/made", paid: false };
  startedThrough(fake, "before_photos", "profile", "piece", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "done" };
  await page.goto(`/jobs/${JOB_ID}/done`);
  const link = page.getByRole("region", { name: closeOut.payment.title });

  fake.resendRefused = "rate_limited";
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.failed.rate_limited);

  fake.online = false;
  await context.setOffline(true);
  await link.getByRole("button", { name: closeOut.payment.resend }).click();
  await expect(link.getByRole("status")).toHaveText(closeOut.payment.failed.offline);
});

test("a way to finish the work chosen with no signal is kept, and goes to ops once there is", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  startedThrough(fake, "before_photos", "checklist", "consumables", "after_photos", "outcome");
  fake.progress = { ...fake.progress, outcome: "partial" };
  await page.goto(`/jobs/${JOB_ID}/done`);
  const finish = page.getByRole("region", { name: closeOut.finish.title });
  await expect(finish).toBeVisible();

  fake.online = false;
  await context.setOffline(true);
  await finish.getByRole("button", { name: closeOut.finish.asks.ops_call }).click();
  await expect(finish.getByRole("status")).toHaveText(closeOut.finish.saved);
  expect(writesTo(fake, "finish-ask")).toHaveLength(0);

  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => writesTo(fake, "finish-ask").at(-1)?.body, { timeout: 20_000 }).toEqual({ ask: "ops_call" });
});

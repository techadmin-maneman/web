// A technician's safety on a visit (docs/decisions/0248-safety.md): the shield in a visit's header opens Safety, the
// SOS goes only once held for three seconds, with the visit and where the phone is, then says when and offers "I'm
// safe"; a refused one says to call; and the phone shares where it is every two minutes while a visit is under way.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { atTheDoor } from "./on-phone.ts";
import { startedThrough } from "./steps-fixtures.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const { safety } = techCopy;

async function onAStep(page: Page): Promise<Fake> {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  startedThrough(fake, "before_photos");
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByRole("dialog", { name: safety.title })).toBeVisible();
  return fake;
}

const sos = (page: Page) => page.getByRole("button", { name: new RegExp(`^${safety.sos}`) });

/** Holds the SOS down for `ms`, then lets go. */
async function hold(page: Page, ms: number): Promise<void> {
  await sos(page).hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("the shield opens Safety: location shared, the SOS to hold, ops' line and 112", async ({ page }) => {
  await onAStep(page);
  const sheet = page.getByRole("dialog", { name: safety.title });
  await expect(sheet).toContainText(safety.sharing);
  await expect(sheet).toContainText(safety.hold);
  await expect(sheet.getByRole("link", { name: techCopy.ops.call })).toHaveAttribute("href", /^tel:\+/);
  await expect(sheet.getByRole("link", { name: safety.call112 })).toHaveAttribute("href", "tel:112");
  // The way out sits on the sheet's dark ::backdrop, which axe cannot see: it would judge paper's words on paper.
  expect(await axeViolations(page, (axe) => axe.exclude("dialog > button"))).toEqual([]);
});

test("an SOS let go before three seconds sends nothing", async ({ page }) => {
  const fake = await onAStep(page);
  await hold(page, 1500);
  await page.waitForTimeout(2000);
  expect(fake.writes.filter((write) => write.path === "/api/tech/sos")).toEqual([]);
  await expect(sos(page)).toBeVisible();
});

test("an SOS held for three seconds goes with the visit and where the phone is, then I'm safe", async ({ page }) => {
  const fake = await onAStep(page);
  await hold(page, 3400);

  await expect(page.getByText(/^SOS sent \d{1,2}:\d{2} [ap]m$/)).toBeVisible();
  await expect(page.getByText(safety.sentBody)).toBeVisible();
  const sent = fake.writes.find((write) => write.path === "/api/tech/sos");
  expect(sent?.body).toMatchObject({ job_id: JOB_ID, position: { lat: 28.39, lng: 77.07 } });

  await page.getByRole("button", { name: safety.safe }).click();
  await expect(page.getByText(safety.safeSaid)).toBeVisible();
  // Opened again, the sheet says where the SOS stands.
  await page.getByRole("button", { name: safety.close }).click();
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByText(safety.safeSaid)).toBeVisible();
});

test("an SOS that cannot go says to call ops or 112 now", async ({ page }) => {
  const fake = await onAStep(page);
  fake.sosRefused = true;
  await hold(page, 3400);
  await expect(page.getByRole("alert").filter({ hasText: safety.failed })).toBeVisible();
});

test("shares where the phone is every two minutes while a visit is under way", async ({ page }) => {
  await page.clock.install();
  const fake = await fakeTech(page);
  await atTheDoor(page);
  startedThrough(fake, "before_photos");
  // Today keeps the day the phone reads the visit under way from.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "3 jobs today" })).toBeVisible();
  await page.clock.fastForward(2 * 60_000 + 1000);
  await expect.poll(() => fake.positions.length).toBeGreaterThanOrEqual(1);
  const before = fake.positions.length;
  await page.clock.fastForward(2 * 60_000);
  await expect.poll(() => fake.positions.length).toBeGreaterThan(before);
  expect(fake.positions.at(-1)).toMatchObject({ lat: 28.39, lng: 77.07 });
});

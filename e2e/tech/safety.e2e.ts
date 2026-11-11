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
  // The closer reading follows to the SOS itself, and raises nothing again.
  const closer = `/api/tech/sos/${fake.sos?.id ?? ""}/position`;
  await expect.poll(() => fake.writes.filter((write) => write.path === closer).length).toBe(1);
  expect(fake.writes.filter((write) => write.path === "/api/tech/sos")).toHaveLength(1);

  await page.getByRole("button", { name: safety.safe }).click();
  await expect(page.getByText(safety.safeSaid)).toBeVisible();
  // Opened again, the sheet says where the SOS stands, and the SOS is there to raise again.
  await page.getByRole("button", { name: safety.close }).click();
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByText(safety.safeSaid)).toBeVisible();
  await hold(page, 3400);
  await expect(page.getByText(safety.sentBody)).toBeVisible();
  expect(fake.writes.filter((write) => write.path === "/api/tech/sos").length).toBeGreaterThanOrEqual(2);
});

test("starts afresh once ops have handled the SOS", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  startedThrough(fake, "before_photos");
  fake.sos = { id: "5e000000-0000-4000-8000-000000000001", sent_at: new Date().toISOString(), safe: false };
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByText(safety.sentBody)).toBeVisible();

  fake.sos = null;
  await page.getByRole("button", { name: safety.close }).click();
  await page.getByRole("button", { name: safety.open }).click();
  await expect(sos(page)).toBeVisible();
  await expect(page.getByText(safety.sentBody)).toHaveCount(0);
});

test("says ops can see the location only while the visit is under way", async ({ page }) => {
  await fakeTech(page);
  await atTheDoor(page);
  // Before the check-in nothing is shared.
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: safety.open }).click();
  await expect(sos(page)).toBeVisible();
  await expect(page.getByText(safety.sharing)).toHaveCount(0);
});

test("still says the location is shared once a check-in made with no signal lands", async ({ page, context }) => {
  const fake = await fakeTech(page);
  fake.startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toBeVisible();
  fake.online = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.notHome.door.title })).toBeVisible();
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByText(safety.sharing)).toBeVisible();
  await page.getByRole("dialog", { name: safety.title }).getByRole("button", { name: safety.close }).click();

  // Signal back: the check-in lands on the same screen, and leaves the outbox.
  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/checkin")).length).toBe(1);
  await expect(page.getByText(/^No signal\. The wait counts from your tap/)).toHaveCount(0);
  await page.getByRole("button", { name: safety.open }).click();
  await expect(page.getByText(safety.sharing)).toBeVisible();
});

test("a slow read from before the SOS never undoes it", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  startedThrough(fake, "before_photos");
  fake.slowSosReadMs = 6000;
  await page.goto(`/jobs/${JOB_ID}/checklist`);
  await page.getByRole("button", { name: safety.open }).click();
  await hold(page, 3400);
  await expect(page.getByText(safety.sentBody)).toBeVisible();
  // The read asked as the sheet opened answers "none open" after the SOS landed.
  await page.waitForTimeout(3500);
  await expect(page.getByText(safety.sentBody)).toBeVisible();
});

test("an SOS that cannot go says to call ops or 112 now", async ({ page }) => {
  const fake = await onAStep(page);
  fake.sosRefused = true;
  await hold(page, 3400);
  await expect(page.getByRole("alert").filter({ hasText: safety.failed })).toBeVisible();
});

test("an I'm safe that cannot go says to call ops, and forgets it for the next SOS", async ({ page }) => {
  const fake = await onAStep(page);
  await hold(page, 3400);
  await expect(page.getByText(safety.sentBody)).toBeVisible();
  fake.sosRefused = true;
  await page.getByRole("button", { name: safety.safe }).click();
  await expect(page.getByRole("alert").filter({ hasText: safety.safeFailed })).toBeVisible();
  await expect(page.getByText(safety.safeSaid)).toHaveCount(0);

  // Ops handle it; a new SOS on the same screen says nothing of the failed word before it.
  fake.sosRefused = false;
  fake.sos = null;
  await page.getByRole("button", { name: safety.close }).click();
  await page.getByRole("button", { name: safety.open }).click();
  await hold(page, 3400);
  await expect(page.getByText(safety.sentBody)).toBeVisible();
  await expect(page.getByText(safety.safeFailed)).toHaveCount(0);
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

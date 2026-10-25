// The job card and the evidence chain at the door: arrive, wait, and
// either start the job or close it as a no-show. A charge-bearing close is
// never one unconfirmed tap, a started job offers nothing but its next step,
// and the wait counts whether or not the phone has signal.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ROHITS_PIECE, ROHITS_PROFILE, TOMORROW_JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { atTheDoor, pageScrolls } from "./on-phone.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

/** The one gold action at the foot of the screen, which the evidence chain hands on stage by stage. */
const foot = (page: Page) => page.locator("main > div").last().getByRole("button");

/** Opens the card and checks in at the door. */
async function arrive(page: Page): Promise<void> {
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();
}

test("sends Navigate to a route any phone opens, by the pin when the address has one", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);

  const navigate = page.getByRole("link", { name: techCopy.job.navigate });
  // ADR 0054: a Maps URL, which needs no key and — unlike `geo:` — opens on an iPhone.
  await expect(navigate).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=28.39%2C77.07");
  // A new tab, so the technician still has the app open behind the map.
  await expect(navigate).toHaveAttribute("target", "_blank");
});

test("says a job that is no longer theirs is off their list, with the way back to Today at the top", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.moved = true;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText(techCopy.job.gone)).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.job.retry })).toHaveCount(0);
  await page.getByRole("button", { name: techCopy.job.backToToday }).first().click();
  await expect(page).toHaveURL(/\/$/);
});

test("sends Navigate to the typed address when it was saved without a pin", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.pin = false;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=Tower%20C%2C%2014th%20floor%2C%20Sector%2065%2C%20Gurgaon%20122018",
  );
});

test("shows the flat, floor, tower, building and landmark, and a way to reach the client", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.address = {
    line1: "Emerald Heights",
    building: "Emerald Heights",
    tower: "C",
    floor: "14th floor",
    flat: "1402",
    landmark: "Opposite the water tank",
  };
  await page.goto(`/jobs/${JOB_ID}`);

  // As the client app writes it, narrowest first (apps/app/src/profile/AddressSection.tsx).
  await expect(page.getByText("1402, 14th floor, C, Emerald Heights, Sector 65, Gurgaon 122018")).toBeVisible();
  // As the client typed it, under its own label, never "Near Opposite the water tank".
  await expect(page.getByText(techCopy.job.landmark, { exact: true })).toBeVisible();
  await expect(page.getByText("Opposite the water tank", { exact: true })).toBeVisible();
  await expect(page.getByText(/Near Opposite/)).toHaveCount(0);
  // A map finds the building, not the flat.
  await expect(page.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute("href", /destination=28\.39/);

  await expect(page.getByRole("link", { name: "Call Rohit" })).toHaveAttribute("href", "tel:+919810000000");
  await expect(page.getByRole("link", { name: "WhatsApp Rohit" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000000",
  );
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the piece on the client’s head and the last visit’s after photograph (board A3)", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.pieces = [ROHITS_PIECE];
  fake.lastVisit = true;
  await page.goto(`/jobs/${JOB_ID}`);

  const piece = page.getByRole("region", { name: techCopy.job.piece.title });
  await expect(piece).toContainText(ROHITS_PIECE.piece_code);
  await expect(piece).toContainText("PLACEHOLDER_STANDARD");
  await expect(piece).toContainText("LOT-4417");
  const photo = page.getByRole("img", { name: techCopy.job.piece.lastVisitImage });
  await expect(photo).toHaveAttribute("src", `/api/tech/jobs/${JOB_ID}/last-visit-photo`);
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await expect(page.getByText(techCopy.job.piece.lastVisit("22 Aug", "Imran"))).toBeVisible();
});

test("says what a first fit was paid for, apart from the hair profile, and warns when they differ", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.type = "first_fit";
  fake.service = { tier: "natural", name: "Mane Man Natural" };
  fake.profile = ROHITS_PROFILE;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("region", { name: techCopy.job.profileTitle })).toContainText("Mane Man Essential");
  const piece = page.getByRole("region", { name: techCopy.job.piece.title });
  await expect(piece).toContainText(techCopy.job.piece.rows.paidFor);
  await expect(piece).toContainText("Mane Man Natural");
  await expect(piece).toContainText("The hair profile says Mane Man Essential. Check with ops before you fit.");
});

// Waiting at the door for the client, the job reads so on Today, which the day's list alone never says.
test("marks a job they checked in at as at the door on Today", async ({ page }) => {
  await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await foot(page).click();
  await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(techCopy.job.states.atTheDoor)).toBeVisible();
});

// On a slow network the card said Loading… each time it opened, though the phone held it.
test("opens a card the phone holds at once on a slow network", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("link", { name: "Call Rohit" })).toBeVisible();
  fake.slowCardMs = 5000;
  await page.reload();
  await expect(page.getByRole("link", { name: "Call Rohit" })).toBeVisible({ timeout: 2000 });
});

test("gives a consultation’s card the hair profile and no piece", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.profile = ROHITS_PROFILE;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("region", { name: techCopy.job.profileTitle })).toBeVisible();
  await expect(page.getByRole("region", { name: techCopy.job.piece.title })).toHaveCount(0);
  await expect(page.getByText(techCopy.job.piece.none)).toHaveCount(0);
});

test("checks in at the door, and records the time and the distance (board B5)", async ({ page }) => {
  const fake = await fakeTech(page);
  // Booked to start ten minutes ago, so the wait runs from the check-in, whatever time of day the test runs.
  fake.startsAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText(techCopy.notHome.arrived.step)).toBeVisible();
  // The radius ops set, not a fixed 200 m.
  await expect(page.getByText("Tap at the door. We record the time and check you are within 150 m.")).toBeVisible();
  // The one action sits at the foot of the card, where every screen keeps it.
  await expect(foot(page)).toHaveText(techCopy.notHome.arrived.action);
  await foot(page).click();

  await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();
  await expect(page.getByText(/left of 15 minutes/)).toBeVisible();
  // Checked in after the booked start, the wait runs from the check-in: never "the booked start" for a moment.
  await expect(page.getByText(/the booked start/)).toHaveCount(0);
  const checkIn = fake.writes.find((write) => write.path.endsWith("/checkin"));
  expect(checkIn?.body).toMatchObject({ lat: 28.39, lng: 77.07 });
  // Every write carries the job's start as the phone holds it, so a job ops moved is refused.
  expect(checkIn?.startsAt).toBe(fake.startsAt);

  expect(await axeViolations(page)).toEqual([]);
});

test("refuses a check-in from away, and says how far, with no way to close a no-show", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.checkIn = { passed: false, distance_m: 1400 };
  await atTheDoor(page, 28.42, 77.12);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page.getByText(techCopy.notHome.failed.title)).toBeVisible();
  await expect(page.getByText("You are 1.4 km from the address.")).toBeVisible();
  await expect(page.getByText(/^Go to the door and tap again\. Still refused\? Call ops\./)).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.waiting.close })).toHaveCount(0);
  // The evidence chain draws the failure with its own outlined Try again, and no second gold "I have arrived" beside it.
  await expect(page.getByRole("button", { name: techCopy.notHome.failed.action })).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);

  expect(await axeViolations(page)).toEqual([]);
});

test("keeps Close as no-show dim and outlined beside the gold Start job until the wait has run", async ({ page }) => {
  const fake = await fakeTech(page);
  // Booked to start ten minutes ago, so the wait runs from the check-in, whatever time of day the test runs.
  fake.startsAt = new Date(Date.now() - 10 * 60_000).toISOString();
  fake.waitLeftMs = 4_000;
  await arrive(page);

  const close = page.getByRole("button", { name: techCopy.notHome.waiting.close });
  await expect(close).toBeDisabled();
  await expect(foot(page)).toHaveText(techCopy.job.start);
  // No WhatsApp reached them, so the wait asks for a call before the close.
  await expect(page.getByRole("link", { name: techCopy.notHome.waiting.callFirst("Rohit") })).toHaveAttribute(
    "href",
    /^tel:/,
  );
  // One gold action per screen: Close as no-show is never the same button as Start job.
  const gold = await close.evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(gold).not.toBe("rgb(201, 163, 99)");

  await expect(close).toBeEnabled({ timeout: 15_000 });
  expect(await close.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgb(201, 163, 99)");
  // The wait's end is said, not only drawn.
  await expect(page.getByRole("status").filter({ hasText: techCopy.notHome.waiting.over })).toBeAttached();
});

test("asks before closing as a no-show, since ops may charge the client", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.reminderDelivered = new Date().toISOString();
  await arrive(page);

  const close = page.getByRole("button", { name: techCopy.notHome.waiting.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: techCopy.notHome.waiting.callFirst("Rohit") })).toHaveCount(0);
  await close.click();

  const sheet = page.getByRole("dialog", { name: techCopy.notHome.confirm.title });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("The client may be charged");
  // It opens on the safe answer, so one stray Enter charges nobody.
  await expect(sheet.getByRole("button", { name: techCopy.notHome.confirm.no })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);

  // A mis-tap is undone with one tap, and nothing was sent.
  await sheet.getByRole("button", { name: techCopy.notHome.confirm.no }).click();
  await expect(sheet).toBeHidden();
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.waiting.close }).click();

  // The evidence chain's close: the evidence ops rule on, and what happens next.
  await expect(page.getByRole("heading", { name: "Rohit M. · no-show" })).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.noShow.ops)).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.noShow.checkedIn)).toBeVisible();
  await expect(page.getByText("40 m")).toBeVisible();
  await expect(page.getByText(/^Delivered /)).toBeVisible();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
  expect(await axeViolations(page)).toEqual([]);
});

// A no-show once carried nothing of the door: no note, and no photograph to settle a dispute with.
test("sends a note and a photograph of the door with the close, the photograph up first", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.reminderDelivered = new Date().toISOString();
  await arrive(page);

  await page.getByLabel(techCopy.notHome.door.note).fill("Rang twice; the gate was locked.");
  await page.getByRole("button", { name: techCopy.notHome.door.photo }).click();
  const take = page.getByRole("button", { name: techCopy.notHome.door.shutter });
  await expect(take).toBeEnabled({ timeout: 10_000 });
  await take.click();
  await expect(page.getByText(techCopy.notHome.door.taken)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  const close = page.getByRole("button", { name: techCopy.notHome.waiting.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.waiting.close }).click();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
  const sent = fake.writes.find((write) => write.path.endsWith("/no-show"))?.body;
  expect(sent).toEqual({ note: "Rang twice; the gate was locked.", door_photo: fake.doorPhotos[0] });
});

test("a no-show the API refuses as early stays open on the card, and never reads as done", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.tooEarly = true;
  await arrive(page);

  const close = page.getByRole("button", { name: techCopy.notHome.waiting.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.waiting.close }).click();

  // The phone's clock ran ahead of ours: nothing was recorded, and the card says so.
  await expect(page.getByText(techCopy.notHome.waiting.early)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  // And the close-out, opened by hand, does not claim the job was done.
  await page.goto(`/jobs/${JOB_ID}/done`);
  await expect(page.getByText("Rohit M. · done")).toHaveCount(0);
  await expect(page.getByText(techCopy.closeOut.notClosed)).toBeVisible();
});

test("a phone that lost its copy of the check-in still counts the wait and can close the no-show", async ({ page }) => {
  const fake = await fakeTech(page);
  // Checked in on another store — the browser, before the app was installed — a minute and more ago.
  const checkedIn = new Date(Date.now() - 16 * 60_000);
  fake.progress = {
    ...fake.progress,
    checked_in_at: checkedIn.toISOString(),
    wait_ends_at: new Date(checkedIn.getTime() + 15 * 60_000).toISOString(),
    distance_m: 40,
  };
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();
  await expect(page.getByText(/^No signal/)).toHaveCount(0);
  await expect(page.getByText("0:00")).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.waiting.close })).toBeEnabled();
});

test("with no signal the wait still counts down from the tap, and says what closing needs", async ({
  page,
  context,
}) => {
  const fake = await fakeTech(page);
  // Booked for an hour ago, so the wait counts from the tap whatever the time of day the test runs.
  fake.startsAt = new Date(Date.now() - 60 * 60_000).toISOString();
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toBeVisible();

  // The basement.
  fake.online = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();

  await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();
  await expect(page.getByText(/^1[45]:\d\d$/)).toBeVisible();
  await expect(page.getByText(/^No signal\. The wait counts from your tap/)).toBeVisible();
  // Ours has to hold the check-in for the wait as well (ADR 0065), so the close waits for signal.
  await expect(page.getByRole("button", { name: techCopy.notHome.waiting.close })).toBeDisabled();
});

test("a started job offers only its next step: no check-in, no no-show, no second Start job", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.progress = {
    ...fake.progress,
    checked_in_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    wait_ends_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    distance_m: 40,
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    steps_done: ["before_photos"],
  };
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(foot(page)).toHaveText(techCopy.job.continueJob);
  await expect(page.getByRole("button", { name: techCopy.notHome.waiting.close })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.job.start })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);
  await expect(page.getByText(techCopy.job.states.inProgress)).toBeVisible();

  await foot(page).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
});

test("a closed job reads as closed, with no gold Continue", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.progress = {
    ...fake.progress,
    checked_in_at: new Date(Date.now() - 90 * 60_000).toISOString(),
    started_at: new Date(Date.now() - 80 * 60_000).toISOString(),
    steps_done: ["before_photos", "checklist", "consumables", "after_photos", "outcome"],
    outcome: "done",
  };
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText("Closed out · done")).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.job.continueJob })).toHaveCount(0);
  await page.getByRole("button", { name: techCopy.job.seeCloseOut }).click();
  await expect(page.getByRole("heading", { name: "Rohit M. · done" })).toBeVisible();
});

test("tomorrow’s job shows its day, and cannot be checked in to today", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  await atTheDoor(page);
  await page.goto(`/jobs/${TOMORROW_JOB_ID}`);

  await expect(page.getByText(/^Tomorrow · 10–10:30 am · service visit · 1 h 30 min$/)).toBeVisible();
  await expect(page.getByText(techCopy.job.notToday.tomorrow)).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.job.start })).toHaveCount(0);
});

test("walks the six steps of a service visit and closes it out (boards B1 to B4)", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await page.getByRole("button", { name: techCopy.job.start }).click();

  // Step 1: the before set.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.capture.before })).toBeVisible();
  const capture = page.getByRole("button", { name: techCopy.capture.take });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: techCopy.steps.outcome.done }).click();

  // Step 2: the checklist, which will not let the job on until it is finished.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.steps.checklist.unfinished })).toBeDisabled();
  for (const item of await page.getByRole("listitem").getByRole("button").all()) await item.click();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: techCopy.steps.next }).click();

  // Step 3: the consumables' steppers, no keyboard anywhere.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.consumables })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: techCopy.steps.next }).click();

  // Step 5: the after set. A service visit has no piece step; the API leaves it out.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.capture.after })).toBeVisible();
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: techCopy.steps.outcome.done }).click();

  // Step 6: the outcome, with nothing chosen for them.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.outcome })).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.steps.outcome.choose })).toBeDisabled();
  await page.getByRole("button", { name: techCopy.steps.outcome.partial, exact: true }).click();
  await expect(page.getByRole("button", { name: techCopy.steps.outcome.pickReason })).toBeDisabled();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  await page.getByRole("button", { name: techCopy.steps.next }).click();

  // The close-out.
  await expect(page.getByText("Rohit M. · partly done")).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.duration)).toBeVisible();
  await expect(page.getByRole("button", { name: /Next job · 11:30/ })).toBeVisible();

  const sent = fake.writes.map((write) => write.path.replace(`/api/tech/jobs/${JOB_ID}`, ""));
  expect(sent).toEqual(["/checkin", "/start", "/photos", "/checklist", "/consumables", "/photos", "/outcome"]);
  expect(fake.writes.at(-1)?.body).toEqual({ outcome: "partial", reason: "client_stopped_it" });
  expect(new Set(fake.writes.map((write) => write.startsAt)).size).toBe(1);

  expect(await axeViolations(page)).toEqual([]);
});

test.describe("on a 360 × 640 phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("keeps I have arrived, then Start job, at the foot of a long card, its head in view", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.pieces = [ROHITS_PIECE];
    fake.lastVisit = true;
    await atTheDoor(page);
    await page.goto(`/jobs/${JOB_ID}`);

    const heading = page.getByRole("heading", { level: 1, name: "Rohit M." });
    await expect(foot(page)).toHaveText(techCopy.notHome.arrived.action);
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    // Only the card scrolls, between the head and the foot: never the page.
    expect(await pageScrolls(page)).toBe(false);

    await foot(page).click();
    await expect(page.getByText(techCopy.notHome.waiting.step)).toBeVisible();
    await expect(foot(page)).toHaveText(techCopy.job.start);
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });
});

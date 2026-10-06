// The job card and the evidence chain at the door: arrive, wait, and
// either start the job or close it as a no-show. A charge-bearing close is
// never one unconfirmed tap, a started job offers nothing but its next step,
// and the wait counts whether or not the phone has signal.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { atTheDoor, fakeTech, JOB_ID, pageScrolls, ROHITS_PIECE, ROHITS_PROFILE, TOMORROW_JOB_ID } from "./fixtures.ts";

/** The one gold action at the foot of the screen, which the evidence chain hands on stage by stage. */
const foot = (page: Page) => page.locator("main > div").last().getByRole("button");

/** Opens the card and checks in at the door. */
async function arrive(page: Page): Promise<void> {
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByText("2 · Waiting")).toBeVisible();
}

test("sends Navigate to a route any phone opens, by the pin when the address has one", async ({ page }) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);

  const navigate = page.getByRole("link", { name: "Navigate" });
  // ADR 0054: a Maps URL, which needs no key and — unlike `geo:` — opens on an iPhone.
  await expect(navigate).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=28.39%2C77.07");
  // A new tab, so the technician still has the app open behind the map.
  await expect(navigate).toHaveAttribute("target", "_blank");
});

test("sends Navigate to the typed address when it was saved without a pin", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.pin = false;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("link", { name: "Navigate" })).toHaveAttribute(
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
  await expect(page.getByText("Landmark", { exact: true })).toBeVisible();
  await expect(page.getByText("Opposite the water tank", { exact: true })).toBeVisible();
  await expect(page.getByText(/Near Opposite/)).toHaveCount(0);
  // A map finds the building, not the flat.
  await expect(page.getByRole("link", { name: "Navigate" })).toHaveAttribute("href", /destination=28\.39/);

  await expect(page.getByRole("link", { name: "Call Rohit" })).toHaveAttribute("href", "tel:+919810000000");
  await expect(page.getByRole("link", { name: "WhatsApp Rohit" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000000",
  );
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the piece on the client's head and the last visit's after photograph (board A3)", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.pieces = [ROHITS_PIECE];
  fake.lastVisit = true;
  await page.goto(`/jobs/${JOB_ID}`);

  const piece = page.getByRole("region", { name: "The piece" });
  await expect(piece).toContainText("MM-STD-4417-B");
  await expect(piece).toContainText("PLACEHOLDER_STANDARD");
  await expect(piece).toContainText("LOT-4417");
  const photo = page.getByRole("img", { name: "Last visit, after" });
  await expect(photo).toHaveAttribute("src", `/api/tech/jobs/${JOB_ID}/last-visit-photo`);
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await expect(page.getByText("Last visit, after. 22 Aug, Imran.")).toBeVisible();
});

test("says what a first fit was paid for, apart from the hair profile, and warns when they differ", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.type = "first_fit";
  fake.service = { tier: "natural", name: "Mane Man Natural" };
  fake.profile = ROHITS_PROFILE;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("region", { name: "Hair profile" })).toContainText("Mane Man Essential");
  const piece = page.getByRole("region", { name: "The piece" });
  await expect(piece).toContainText("Paid for");
  await expect(piece).toContainText("Mane Man Natural");
  await expect(piece).toContainText("The hair profile says Mane Man Essential. Check with ops before you fit.");
});

test("gives a consultation's card the hair profile and no piece", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.profile = ROHITS_PROFILE;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("region", { name: "Hair profile" })).toBeVisible();
  await expect(page.getByRole("region", { name: "The piece" })).toHaveCount(0);
  await expect(page.getByText("No piece recorded for this client yet.")).toHaveCount(0);
});

test("checks in at the door, and records the time and the distance (board B5)", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByText("1 · Arrived")).toBeVisible();
  // The radius ops set, not a fixed 200 m.
  await expect(page.getByText("Tap at the door. We record the time and check you are within 150 m.")).toBeVisible();
  // The one action sits at the foot of the card, where every screen keeps it.
  await expect(foot(page)).toHaveText("I have arrived");
  await foot(page).click();

  await expect(page.getByText("2 · Waiting")).toBeVisible();
  await expect(page.getByText(/left of 15 minutes/)).toBeVisible();
  const checkIn = fake.writes.find((write) => write.path.endsWith("/checkin"));
  expect(checkIn?.body).toMatchObject({ lat: 28.39, lng: 77.07 });
  // Every write carries the job's start as the phone holds it, so a job ops moved is refused.
  expect(checkIn?.startsAt).toMatch(/T04:00:00\.000Z$/);

  expect(await axeViolations(page)).toEqual([]);
});

test("refuses a check-in from away, and says how far, with no way to close a no-show", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.checkIn = { passed: false, distance_m: 1400 };
  await atTheDoor(page, 28.42, 77.12);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: "I have arrived" }).click();
  await expect(page.getByText("Check-in failed")).toBeVisible();
  await expect(page.getByText("You are 1.4 km from the address.")).toBeVisible();
  await expect(
    page.getByText(/^Get to the door and tap again\. Still refused at the door\? Ask ops to let you check in\./),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Close as no-show" })).toHaveCount(0);
  // The evidence chain draws the failure with its own outlined Try again, and no second gold "I have arrived" beside it.
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);

  expect(await axeViolations(page)).toEqual([]);
});

test("keeps Close as no-show dim and outlined beside the gold Start job until the wait has run", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 4_000;
  await arrive(page);

  const close = page.getByRole("button", { name: "Close as no-show" });
  await expect(close).toBeDisabled();
  await expect(foot(page)).toHaveText("Start job");
  // One gold action per screen: Close as no-show is never the same button as Start job.
  const gold = await close.evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(gold).not.toBe("rgb(201, 163, 99)");

  await expect(close).toBeEnabled({ timeout: 15_000 });
  expect(await close.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe("rgb(201, 163, 99)");
  // The wait's end is said, not only drawn.
  await expect(page.getByRole("status").filter({ hasText: "The wait is over." })).toBeAttached();
});

test("asks before closing as a no-show, since ops may charge the client", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.reminderDelivered = new Date().toISOString();
  await arrive(page);

  const close = page.getByRole("button", { name: "Close as no-show" });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();

  const sheet = page.getByRole("dialog", { name: "Close as a no-show?" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Ops may charge the client");
  // It opens on the safe answer, so one stray Enter charges nobody.
  await expect(sheet.getByRole("button", { name: "Not yet" })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);

  // A mis-tap is undone with one tap, and nothing was sent.
  await sheet.getByRole("button", { name: "Not yet" }).click();
  await expect(sheet).toBeHidden();
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: "Close as no-show" }).click();

  // The evidence chain's close: the evidence ops rule on, and what happens next.
  await expect(page.getByRole("heading", { name: "Rohit M. · no-show" })).toBeVisible();
  await expect(page.getByText("This goes to ops with the charge.")).toBeVisible();
  await expect(page.getByText("Checked in")).toBeVisible();
  await expect(page.getByText("40 m")).toBeVisible();
  await expect(page.getByText(/^Delivered /)).toBeVisible();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
  expect(await axeViolations(page)).toEqual([]);
});

test("a no-show the API refuses as early stays open on the card, and never reads as done", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.tooEarly = true;
  await arrive(page);

  const close = page.getByRole("button", { name: "Close as no-show" });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: "Close as no-show" }).click();

  // The phone's clock ran ahead of ours: nothing was recorded, and the card says so.
  await expect(page.getByText("Our clock says the wait hasn’t run out yet. Try again in a minute.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  // And the close-out, opened by hand, does not claim the job was done.
  await page.goto(`/jobs/${JOB_ID}/done`);
  await expect(page.getByText("Rohit M. · done")).toHaveCount(0);
  await expect(page.getByText("This job isn’t closed yet.")).toBeVisible();
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

  await expect(page.getByText("2 · Waiting")).toBeVisible();
  await expect(page.getByText(/^No signal/)).toHaveCount(0);
  await expect(page.getByText("0:00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close as no-show" })).toBeEnabled();
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
  await expect(page.getByRole("button", { name: "I have arrived" })).toBeVisible();

  // The basement.
  fake.online = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: "I have arrived" }).click();

  await expect(page.getByText("2 · Waiting")).toBeVisible();
  await expect(page.getByText(/^1[45]:\d\d$/)).toBeVisible();
  await expect(page.getByText(/^No signal\. The wait counts from your tap/)).toBeVisible();
  // Ours has to hold the check-in for the wait as well (ADR 0065), so the close waits for signal.
  await expect(page.getByRole("button", { name: "Close as no-show" })).toBeDisabled();
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

  await expect(foot(page)).toHaveText("Continue");
  await expect(page.getByRole("button", { name: "Close as no-show" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);
  await expect(page.getByText("In progress")).toBeVisible();

  await foot(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await page.getByRole("button", { name: "See the close-out" }).click();
  await expect(page.getByRole("heading", { name: "Rohit M. · done" })).toBeVisible();
});

test("tomorrow's job shows its day, and cannot be checked in to today", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  await atTheDoor(page);
  await page.goto(`/jobs/${TOMORROW_JOB_ID}`);

  await expect(page.getByText(/^Tomorrow · 10 am · service visit · 90 min$/)).toBeVisible();
  await expect(page.getByText("This job is tomorrow. Arrive and start it on the day.")).toBeVisible();
  await expect(page.getByRole("button", { name: "I have arrived" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start job" })).toHaveCount(0);
});

test("walks the six steps of a service visit and closes it out (boards B1 to B4)", async ({ page }) => {
  const fake = await fakeTech(page);
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: "I have arrived" }).click();
  await page.getByRole("button", { name: "Start job" }).click();

  // Step 1: the before set.
  await expect(page.getByRole("heading", { level: 1, name: "Before photos" })).toBeVisible();
  const capture = page.getByRole("button", { name: "Capture" });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();

  // Step 2: the checklist, which will not let the job on until it is finished.
  await expect(page.getByRole("heading", { level: 1, name: "Service checklist" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish the list to continue" })).toBeDisabled();
  for (const item of await page.getByRole("listitem").getByRole("button").all()) await item.click();
  expect(await axeViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: the consumables' steppers, no keyboard anywhere.
  await expect(page.getByRole("heading", { level: 1, name: "Consumables used" })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Step 5: the after set. A service visit has no piece step; the API leaves it out.
  await expect(page.getByRole("heading", { level: 1, name: "After photos" })).toBeVisible();
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(`${String(angle)} of 5`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done" }).click();

  // Step 6: the outcome, with nothing chosen for him.
  await expect(page.getByRole("heading", { level: 1, name: "Outcome" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose Done or Partial" })).toBeDisabled();
  await page.getByRole("button", { name: "Partial · pick a reason" }).click();
  await expect(page.getByRole("button", { name: "Pick a reason to continue" })).toBeDisabled();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // The close-out.
  await expect(page.getByText("Rohit M. · partial")).toBeVisible();
  await expect(page.getByText("Duration")).toBeVisible();
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
    await expect(foot(page)).toHaveText("I have arrived");
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    // Only the card scrolls, between the head and the foot: never the page.
    expect(await pageScrolls(page)).toBe(false);

    await foot(page).click();
    await expect(page.getByText("2 · Waiting")).toBeVisible();
    await expect(foot(page)).toHaveText("Start job");
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });
});

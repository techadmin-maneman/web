// The job and At the door (docs/decisions/0243-job-and-the-door.md): check in, wait, and either start the visit or close
// it as a no-show. A charge-bearing close is never one unconfirmed tap, and it waits for the WhatsApp's state, a call
// and the door's photograph as well as the wait. A started job offers nothing but its next step, and the wait counts
// whether or not the phone has signal.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { JOB_ID, ROHITS_PIECE, ROHITS_PROFILE, TOMORROW_JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { atTheDoor, pageScrolls } from "./on-phone.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { stepAction, throughTheTasks, shots } from "./steps-fixtures.ts";

const door = techCopy.notHome.door;

/** The action bar at the foot of the screen, which the job hands on stage by stage. */
const foot = (page: Page) => page.locator("main > div").last().getByRole("button");

/** Opens the job and checks in at the door, which opens At the door. */
async function arrive(page: Page): Promise<void> {
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
}

/** What a no-show needs besides the wait: the call made from the door, and its photograph. */
async function gatherEvidence(page: Page): Promise<void> {
  // A tel: link the browser cannot follow; the tap is what the phone keeps.
  await page.getByRole("link", { name: door.call("Rohit") }).dispatchEvent("click");
  await expect(page.getByText(/^Called /)).toBeVisible();
  await page.getByRole("button", { name: door.take, exact: true }).click();
  const shutter = page.getByRole("button", { name: techCopy.notHome.camera.shutter });
  await expect(shutter).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByText(techCopy.notHome.camera.prompt)).toBeVisible();
  await shutter.click();
  await expect(page.getByText(door.taken, { exact: true })).toBeVisible();
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

test("gives Navigate, Call and Message as three tiles of one height, each naming the client to a screen reader", async ({
  page,
}) => {
  await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  const call = page.getByRole("link", { name: techCopy.job.call("Rohit"), exact: true });
  const tiles = [
    page.getByRole("link", { name: techCopy.job.navigate }),
    call,
    page.getByRole("button", { name: techCopy.job.message("Rohit"), exact: true }),
  ];
  await expect(call).toHaveAttribute("href", "tel:+919810000000");
  const heights = await Promise.all(tiles.map((tile) => tile.evaluate((each) => each.clientHeight)));
  expect(new Set(heights).size).toBe(1);
});

test("sends the client an update from the Message sheet, once, and says what went", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: techCopy.job.message("Rohit") }).click();

  const sheet = page.getByRole("dialog", { name: techCopy.job.tell.title("Rohit") });
  await sheet.getByRole("button", { name: techCopy.job.tell.minute(30) }).click();
  await sheet.getByRole("button", { name: techCopy.job.tell.onTheWay(30) }).click();
  await expect(page.getByText(techCopy.job.tell.sent(techCopy.job.tell.onTheWay(30)))).toBeVisible();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/updates")).length).toBe(1);
  expect(fake.writes.find((write) => write.path.endsWith("/updates"))?.body).toEqual({
    preset: "on_the_way",
    minutes: 30,
  });
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

test("sends Navigate to the typed address when it was saved without a pin, and says it has none", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.pin = false;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=Tower%20C%2C%2014th%20floor%2C%20Sector%2065%2C%20Gurgaon%20122018",
  );
  await expect(page.getByRole("img", { name: techCopy.job.map.noPin })).toBeVisible();
});

test("shows the flat, floor, tower, building and landmark, the way in with Copy, and the client's note", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.address = {
    line1: "Emerald Heights",
    building: "Emerald Heights",
    tower: "C",
    floor: "14th floor",
    flat: "1402",
    landmark: "Opposite the water tank",
  };
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/jobs/${JOB_ID}`);

  // As the client app writes it, narrowest first (apps/app/src/profile/AddressSection.tsx).
  await expect(page.getByText("1402, 14th floor, C, Emerald Heights, Sector 65, Gurgaon 122018")).toBeVisible();
  // As the client typed it, never "Near Opposite the water tank".
  await expect(page.getByText("Opposite the water tank", { exact: true })).toBeVisible();
  await expect(page.getByText(/Near Opposite/)).toHaveCount(0);
  // A map finds the building, not the flat.
  await expect(page.getByRole("link", { name: techCopy.job.navigate })).toHaveAttribute("href", /destination=28\.39/);

  await page.getByRole("button", { name: techCopy.job.copyWayIn }).click();
  await expect(page.getByRole("status").filter({ hasText: techCopy.job.copied })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Gate code 4417 · visitor bay B");
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
test("marks a job they checked in at as at the door on Today, and opens At the door from the job", async ({ page }) => {
  await fakeTech(page);
  await arrive(page);

  await page.goto("/");
  await expect(page.getByText(techCopy.job.states.atTheDoor)).toBeVisible();
  await page.goto(`/jobs/${JOB_ID}`);
  await foot(page).click();
  await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
});

// On a slow network the job said Loading… each time it opened, though the phone held it.
test("opens a job the phone holds at once on a slow network", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(page.getByRole("link", { name: "Call Rohit" })).toBeVisible();
  fake.slowCardMs = 5000;
  await page.reload();
  await expect(page.getByRole("link", { name: "Call Rohit" })).toBeVisible({ timeout: 2000 });
});

test("gives a consultation the hair profile and no piece", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  fake.profile = ROHITS_PROFILE;
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("region", { name: techCopy.job.profileTitle })).toBeVisible();
  await expect(page.getByRole("region", { name: techCopy.job.piece.title })).toHaveCount(0);
  await expect(page.getByText(techCopy.job.piece.none)).toHaveCount(0);
});

test("opens a consultation’s Options: each package and what it costs, and the client’s looks", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.type = "consultation";
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("link", { name: techCopy.options.link }).click();

  await expect(page.getByRole("heading", { level: 1, name: techCopy.options.title })).toBeVisible();
  const essential = page.getByRole("region", { name: "Mane Man Essential" });
  await expect(essential.getByRole("term")).toHaveText([
    techCopy.options.firstFit,
    techCopy.options.service(30),
    techCopy.options.replacement(6),
  ]);
  await expect(essential.getByRole("definition")).toHaveText(["Rs. 37,760", "Rs. 2,360", techCopy.options.noPrice]);
  await expect(page.getByRole("img", { name: techCopy.options.look("20 Sep") })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("checks in at the door, and records the time and the distance", async ({ page }) => {
  const fake = await fakeTech(page);
  // Booked to start ten minutes ago, so the wait runs from the check-in, whatever time of day the test runs.
  fake.startsAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);

  // The radius ops set is said only when a check-in is refused for it, not above the action.
  await expect(page.getByText("Check in within 150 m of the door.")).toHaveCount(0);
  await expect(foot(page)).toHaveText(techCopy.notHome.arrived.action);
  await foot(page).click();

  await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
  await expect(page.getByText(door.waitingFor("Rohit"))).toBeVisible();
  await expect(page.getByText(door.of(15))).toBeVisible();
  // Checked in after the booked start, the wait runs from the check-in: never "the booked start" for a moment.
  await expect(page.getByText(/the booked start/)).toHaveCount(0);
  const checkIn = fake.writes.find((write) => write.path.endsWith("/checkin"));
  expect(checkIn?.body).toMatchObject({ lat: 28.39, lng: 77.07 });
  // Every write carries the job's start as the phone holds it, so a job ops moved is refused.
  expect(checkIn?.startsAt).toBe(fake.startsAt);

  expect(await axeViolations(page)).toEqual([]);
});

test("refuses a check-in from away, and says how far, with Try again and no way to close a no-show", async ({
  page,
}) => {
  const fake = await fakeTech(page);
  fake.checkIn = { passed: false, distance_m: 1400 };
  await atTheDoor(page, 28.42, 77.12);
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page.getByText(techCopy.notHome.failed.title)).toBeVisible();
  await expect(
    page.getByText(
      /You are 1\.4 km from the address\. Check in within 150 m of the door\. Go to the door and tap again\./,
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await expect(page.getByRole("button", { name: door.close })).toHaveCount(0);
  await expect(foot(page)).toHaveText(techCopy.job.retry);

  expect(await axeViolations(page)).toEqual([]);
});

test("keeps Close as no-show off until the wait has run, and says what it waits on", async ({ page }) => {
  const fake = await fakeTech(page);
  // Booked to start ten minutes ago, so the wait runs from the check-in, whatever time of day the test runs.
  fake.startsAt = new Date(Date.now() - 10 * 60_000).toISOString();
  fake.waitLeftMs = 4_000;
  await arrive(page);

  const close = page.getByRole("button", { name: door.close });
  await expect(close).toBeDisabled();
  await expect(page.getByText(door.waitFirst)).toBeVisible();
  await expect(foot(page)).toHaveText(techCopy.job.start);

  // The wait's end is said, not only drawn; then the call and the photograph are what is missing.
  await expect(page.getByRole("status").filter({ hasText: door.over })).toBeAttached({ timeout: 15_000 });
  await expect(page.getByText(door.evidenceFirst)).toBeVisible();
  await expect(close).toBeDisabled();
});

test("keeps Close as no-show off with the call alone, and keeps the call through a reload", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  await arrive(page);
  const close = page.getByRole("button", { name: door.close });
  await expect(page.getByText(door.evidenceFirst)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("link", { name: door.call("Rohit") }).dispatchEvent("click");
  await expect(page.getByText(/^Called /)).toBeVisible();
  await expect(close).toBeDisabled();
  await expect(page.getByText(door.evidenceFirst)).toBeVisible();

  // The call is kept on the phone: a reload still has it, and the photograph alone is now what is missing.
  await page.reload();
  await expect(page.getByText(/^Called /)).toBeVisible();
  await expect(close).toBeDisabled();
});

test("keeps Close as no-show off with the photograph alone", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  await arrive(page);
  await page.getByRole("button", { name: door.take, exact: true }).click();
  const shutter = page.getByRole("button", { name: techCopy.notHome.camera.shutter });
  await expect(shutter).toBeEnabled({ timeout: 10_000 });
  await shutter.click();
  await expect(page.getByText(door.taken, { exact: true })).toBeVisible();
  await expect(page.getByText(door.evidenceFirst)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: door.close })).toBeDisabled();
});

test("asks before closing as a no-show, since ops decide on the charge", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.reminderDelivered = new Date().toISOString();
  await arrive(page);
  await expect(page.getByText(/^Delivered /)).toBeVisible();
  await gatherEvidence(page);

  const close = page.getByRole("button", { name: door.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();

  const sheet = page.getByRole("dialog", { name: techCopy.notHome.confirm.title });
  await expect(sheet).toContainText(techCopy.notHome.confirm.prepaid("Rohit"));
  // It opens on the safe answer, so one stray Enter charges nobody.
  await expect(sheet.getByRole("button", { name: techCopy.notHome.confirm.no })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);

  // A mis-tap is undone with one tap, and nothing was sent.
  await sheet.getByRole("button", { name: techCopy.notHome.confirm.no }).click();
  await expect(sheet).toBeHidden();
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.confirm.yes }).click();

  // The close: the evidence ops rule on, and what happens next.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.closeOut.titles.no_show })).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.noShow.ops)).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.noShow.checkedIn)).toBeVisible();
  await expect(page.getByText("40 m")).toBeVisible();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
  expect(await axeViolations(page)).toEqual([]);
});

// A no-show once carried nothing of the door: no note, and no photograph to settle a dispute with.
test("sends a note and the door's photograph with the close, the photograph up first", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.reminderDelivered = new Date().toISOString();
  await arrive(page);

  await page.getByLabel(door.note).fill("Rang twice; the gate was locked.");
  await gatherEvidence(page);
  expect(await axeViolations(page)).toEqual([]);

  const close = page.getByRole("button", { name: door.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.confirm.yes }).click();
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/no-show")).length).toBe(1);
  const sent = fake.writes.find((write) => write.path.endsWith("/no-show"))?.body;
  expect(sent).toEqual({ note: "Rang twice; the gate was locked.", door_photo: fake.doorPhotos[0] });
});

test("a no-show the API refuses as early stays open at the door, and never reads as done", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.waitLeftMs = 1_000;
  fake.tooEarly = true;
  await arrive(page);
  await gatherEvidence(page);

  const close = page.getByRole("button", { name: door.close });
  await expect(close).toBeEnabled({ timeout: 10_000 });
  await close.click();
  await page.getByRole("dialog").getByRole("button", { name: techCopy.notHome.confirm.yes }).click();

  // The phone's clock ran ahead of ours: nothing was recorded, and the screen says so.
  await expect(page.getByText(door.early)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/door$`));
  expect(fake.writes.filter((write) => write.path.endsWith("/no-show"))).toHaveLength(0);

  // And the close-out, opened by hand, does not claim the job was done.
  await page.goto(`/jobs/${JOB_ID}/done`);
  await expect(page.getByRole("heading", { level: 1, name: techCopy.closeOut.titles.closed })).toHaveCount(0);
  await expect(page.getByText(techCopy.closeOut.notClosed)).toBeVisible();

  // Nor does Today's head call it a failed upload: it is tried again when its time comes.
  await page.goto("/");
  await expect(page.getByText(techCopy.today.sync.synced)).toBeVisible();
  await expect(page.getByText(/uploads? failed$/)).toHaveCount(0);
});

test("a phone that lost its copy of the check-in still counts the wait at the door", async ({ page }) => {
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
  await expect(foot(page)).toHaveText(techCopy.job.atTheDoor);
  await foot(page).click();

  await expect(page.getByText(/^No signal/)).toHaveCount(0);
  await expect(page.getByText("15:00")).toBeVisible();
  await expect(page.getByText(door.evidenceFirst)).toBeVisible();

  // The call is kept though the phone holds no check-in of its own, and with the photograph the close opens.
  await gatherEvidence(page);
  await expect(page.getByRole("button", { name: door.close })).toBeEnabled();
});

test("with no signal the wait still counts from the tap, and says what closing needs", async ({ page, context }) => {
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

  await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
  await expect(page.getByText(/^0:0\d$/)).toBeVisible();
  await expect(page.getByText(/^No signal\. The wait counts from your tap/)).toBeVisible();
  // Ours has to hold the check-in for the wait as well (ADR 0065), so the close waits for signal.
  await expect(page.getByRole("button", { name: door.close })).toBeDisabled();

  // Signal back: the check-in lands, and At the door stays open through it.
  fake.online = true;
  await context.setOffline(false);
  await expect.poll(() => fake.writes.filter((write) => write.path.endsWith("/checkin")).length).toBe(1);
  await expect(page.getByText(/^No signal\. The wait counts from your tap/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/door$`));
});

test("a started job offers only its next step: no check-in, no door, no second Start visit", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: techCopy.job.atTheDoor })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.job.start })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);
  await expect(page.getByText(techCopy.job.states.inProgress)).toBeVisible();

  // At the door, opened by hand, goes back to the job: the visit is under way.
  await page.goto(`/jobs/${JOB_ID}/door`);
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
  await foot(page).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
});

test("a closed job reads as closed, with View summary", async ({ page }) => {
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
  await page.getByRole("button", { name: techCopy.job.viewSummary }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.closeOut.titles.closed })).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.sub("Rohit M.", "service visit", "done"))).toBeVisible();
});

test("tomorrow’s job shows its day, and cannot be checked in to today", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.tomorrow = true;
  await atTheDoor(page);
  await page.goto(`/jobs/${TOMORROW_JOB_ID}`);

  await expect(page.getByText(/^Tomorrow · 10 to 10:30 am · service visit · no charge$/)).toBeVisible();
  await expect(page.getByText(techCopy.job.notToday.tomorrow)).toBeVisible();
  await expect(page.getByRole("button", { name: techCopy.notHome.arrived.action })).toHaveCount(0);
  await expect(page.getByRole("button", { name: techCopy.job.start })).toHaveCount(0);
});

test("walks the steps of a service visit and closes it out", async ({ page }) => {
  const fake = await fakeTech(page);
  await arrive(page);
  await page.getByRole("button", { name: techCopy.job.start }).click();

  // Step 1: the before set.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.capture.before })).toBeVisible();
  const capture = page.getByRole("button", { name: techCopy.capture.take });
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(shots(angle), { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: techCopy.capture.finish, exact: true }).click();

  // Step 2: the guided tasks, one a screen, each passed by Next task.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.checklist })).toBeVisible();
  await expect(stepAction(page)).toHaveText(techCopy.visit.nextTask);
  await throughTheTasks(page);
  expect(await axeViolations(page)).toEqual([]);
  await stepAction(page).click();

  // Step 3: the consumables' steppers, no keyboard anywhere.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.consumables })).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await page.getByRole("button", { name: "One more tape strips" }).click();
  await stepAction(page).click();

  // Step 4: the after set. A service visit has no piece step; the API leaves it out.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.capture.after })).toBeVisible();
  await expect(capture).toBeEnabled();
  for (let angle = 1; angle <= 5; angle += 1) {
    await capture.click();
    await expect(page.getByText(shots(angle), { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: techCopy.capture.finish, exact: true }).click();

  // Step 5: the outcome, with nothing chosen for them.
  await expect(page.getByRole("heading", { level: 1, name: techCopy.steps.titles.outcome })).toBeVisible();
  await expect(page.getByText(techCopy.steps.outcome.choose, { exact: true })).toBeVisible();
  await expect(stepAction(page)).toBeDisabled();
  await page.getByRole("radio", { name: techCopy.steps.outcome.partial, exact: true }).click();
  await expect(page.getByText(techCopy.steps.outcome.pickReason, { exact: true })).toBeVisible();
  await expect(stepAction(page)).toBeDisabled();
  await page.getByRole("button", { name: "Client stopped it partway" }).click();
  await stepAction(page).click();

  // The close-out.
  await expect(page.getByText(techCopy.closeOut.sub("Rohit M.", "service visit", "partly done"))).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.duration)).toBeVisible();
  await expect(page.getByText(techCopy.closeOut.paymentRow)).toBeVisible();
  await expect(page.getByText(techCopy.badges.prepaid, { exact: true })).toBeVisible();
  // The next job, its client and the drive there, with the way to Today and to its door.
  const next = page.getByRole("region", { name: techCopy.closeOut.next.title });
  await expect(next).toContainText("11:30 am · Vikram S.");
  await expect(next).toContainText(techCopy.closeOut.next.drive(20));
  await expect(page.getByRole("button", { name: techCopy.closeOut.next.today })).toBeVisible();
  // A visit left partly done asks how to finish it.
  await expect(page.getByRole("region", { name: techCopy.closeOut.finish.title })).toBeVisible();

  const sent = fake.writes.map((write) => write.path.replace(`/api/tech/jobs/${JOB_ID}`, ""));
  expect(sent).toEqual(["/checkin", "/start", "/photos", "/checklist", "/consumables", "/photos", "/outcome"]);
  expect(fake.writes.at(-1)?.body).toEqual({ outcome: "partial", reason: "client_stopped_it" });
  expect(new Set(fake.writes.map((write) => write.startsAt)).size).toBe(1);

  expect(await axeViolations(page)).toEqual([]);
});

test.describe("on a 360 × 640 phone", () => {
  test.use({ viewport: { width: 360, height: 640 } });

  test("keeps Check in, then Start visit, at the foot of a long screen, its head in view", async ({ page }) => {
    const fake = await fakeTech(page);
    fake.pieces = [ROHITS_PIECE];
    fake.lastVisit = true;
    await atTheDoor(page);
    await page.goto(`/jobs/${JOB_ID}`);

    await expect(foot(page)).toHaveText(techCopy.notHome.arrived.action);
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("heading", { level: 1, name: "Rohit M." })).toBeInViewport({ ratio: 1 });
    // Only the body scrolls, between the head and the foot: never the page.
    expect(await pageScrolls(page)).toBe(false);

    await foot(page).click();
    await expect(page.getByRole("heading", { level: 1, name: door.title })).toBeInViewport({ ratio: 1 });
    await expect(foot(page)).toHaveText(techCopy.job.start);
    await expect(foot(page)).toBeInViewport({ ratio: 1 });
    expect(await pageScrolls(page)).toBe(false);
  });
});

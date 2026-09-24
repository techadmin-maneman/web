// Technicians (board D3): the roster, the jobs each has finished and how those
// ran, and the phones each has logged in on, with a revoke. The API is answered
// from e2e/ops/fixtures.ts, since a local database has no technician until
// FSM's mirror has run and none has logged in.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, LEAVE_CANCELLED, LEAVE_RECORDED, TECHNICIAN_WORK, TECHNICIANS } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const IMRAN = "88000000-0000-4000-8000-000000000001";
const SANDEEP = "88000000-0000-4000-8000-000000000002";
const REVOKE = `/api/technicians/${IMRAN}/devices/device-1/revoke`;
const LEAVE = `/api/technicians/${IMRAN}/leave`;
const CANCEL = `/api/technicians/${SANDEEP}/leave/89000000-0000-4000-8000-000000000001/cancel`;
const WORK = "/api/technicians/work";
const PHONE = "Revoke Chrome on Android of Imran Qureshi";

async function open(
  page: Page,
  revoke = json({ revoked_at: "2027-09-22T06:00:00.000Z" }),
  leave = json(LEAVE_RECORDED),
): Promise<void> {
  await answer(page, {
    "/api/technicians": json(TECHNICIANS),
    [WORK]: json(TECHNICIAN_WORK),
    [REVOKE]: revoke,
    [LEAVE]: leave,
    [CANCEL]: json(LEAVE_CANCELLED),
  });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

test("lists every active technician with the zone the board draws", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 40–65");
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("Sec 1–39");
  // A technician the mirror has no zone for reads as a gap, as the design's tables write one.
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("—");
});

test("counts the jobs each has finished, and how long those took", async ({ page }) => {
  await open(page);
  // Faizan is the board's own line: 1 h 48 m against the 90 minutes a service visit is planned for.
  const faizan = page.getByRole("row").filter({ hasText: "Faizan Ali" });
  await expect(faizan).toContainText("29");
  await expect(faizan).toContainText("1 h 48 m");
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("1 h 24 m");
});

// The average is of the jobs the phone timed from Start to the outcome, which
// is not always every job finished, so the cell says what it is of.
test("says what the average is of when the phone timed fewer jobs than were finished", async ({ page }) => {
  await open(page);
  const sandeep = page.getByRole("row").filter({ hasText: "Sandeep Yadav" });
  await expect(sandeep).toContainText("1 h 31 m");
  await expect(sandeep).toContainText("30 of 34");
});

// The board letters 1 h 48 m in brass and leaves 1 h 31 m quiet, so a minute
// over the planned length is not a technician running over (content.ts, overBy).
test("letters an average that runs over in brass, and leaves one a minute over quiet", async ({ page }) => {
  await open(page);
  const brass = "rgb(122, 91, 36)"; // --brass-text
  const over = page.getByRole("row").filter({ hasText: "Faizan Ali" }).getByText("1 h 48 m");
  const near = page.getByRole("row").filter({ hasText: "Sandeep Yadav" }).getByText("1 h 31 m");
  await expect(over).toHaveCSS("color", brass);
  await expect(near).not.toHaveCSS("color", brass);
});

// A job that was done and never timed is not a job that took no time.
test("reads as a gap, never as a nought, when the phone timed none of the jobs", async ({ page }) => {
  const untimed = TECHNICIAN_WORK.technicians.map((each) => ({
    ...each,
    timed_jobs: 0,
    average_minutes: null,
    average_planned_minutes: null,
  }));
  await answer(page, {
    "/api/technicians": json(TECHNICIANS),
    [WORK]: json({ ...TECHNICIAN_WORK, technicians: untimed }),
  });
  await page.goto("/technicians");

  const imran = page.getByRole("row").filter({ hasText: "Imran Qureshi" });
  await expect(imran).toContainText("48");
  await expect(imran).toContainText("—");
  await expect(imran).not.toContainText("0 m");
});

// Nothing records what a technician is trained for, so the board's fifth column
// is not drawn and the table says why (docs/open-points.md, item 59).
test("draws no Skill column, and says beneath the table why not", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader", { name: "Skill" })).toBeHidden();
  await expect(page.getByText("Nothing records what a technician is trained for")).toBeVisible();
  await expect(page.getByText("Jobs finished from 24 Jun 2027 to 22 Sep 2027.")).toBeVisible();
});

test("shows each technician's phones, and says when one is revoked already", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Chrome on Android")).toBeVisible();
  await expect(page.getByText("last used 22 Sep 2027")).toBeVisible();
  await expect(page.getByText("Revoked 5 Aug 2027")).toBeVisible();
  // A phone whose browser gave no label at login, and a technician who has logged in on none.
  await expect(page.getByText("A phone")).toBeVisible();
  await expect(page.getByText("No phone logged in.")).toBeVisible();
});

test("offers no revoke on a phone that is revoked already", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: "Revoke Safari on iPhone of Imran Qureshi" })).toBeHidden();
});

test("asks before it revokes a phone, and says what a revoke does", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: PHONE }).click();
  await expect(page.getByText("The session ends, and the phone drops its cached jobs")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(REVOKE) && request.method() === "POST");
  await page.getByRole("button", { name: "Revoke this phone" }).click();
  await sent;
  await expect(page.getByText("Revoked 22 Sep 2027")).toBeVisible();
});

test("keeps the phone when the revoke is called off", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: PHONE }).click();
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: PHONE })).toBeVisible();
  await expect(page.getByText("Revoked 22 Sep 2027")).toBeHidden();
});

test("says so when the phone is no longer that technician's", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await page.getByRole("button", { name: PHONE }).click();
  await page.getByRole("button", { name: "Revoke this phone" }).click();
  await expect(page.getByRole("alert")).toContainText("That phone is not this technician's any more.");
});

test("says so when the roster cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "/api/technicians": fails(503, "unavailable"), [WORK]: json(TECHNICIAN_WORK) });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/technicians": json(TECHNICIANS), [WORK]: json(TECHNICIAN_WORK) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
});

// The table is one table, so a figure that did not load takes the roster with
// it rather than leaving a column of gaps that look like noughts.
test("says so when the figures cannot be loaded, and loads them on Try again", async ({ page }) => {
  await answer(page, { "/api/technicians": json(TECHNICIANS), [WORK]: fails(503, "unavailable") });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/technicians": json(TECHNICIANS), [WORK]: json(TECHNICIAN_WORK) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("1 h 48 m");
});

test("says so when no technician is active", async ({ page }) => {
  await answer(page, {
    "/api/technicians": json({ technicians: [] }),
    [WORK]: json({ ...TECHNICIAN_WORK, technicians: [] }),
  });
  await page.goto("/technicians");
  await expect(page.getByText("No technician is active.")).toBeVisible();
});

// Leave is recorded here because FSM has nowhere to keep it (ADR 0060), and it
// is the same rows the dispatch board reads, so it says what it does before it
// is sent.
test("lists the leave each technician is down for, and says when there is none", async ({ page }) => {
  await open(page);
  await expect(page.getByText("2 Oct 2027 to 6 Oct 2027")).toBeVisible();
  await expect(page.getByText("Family wedding")).toBeVisible();
  await expect(page.getByText("No leave recorded.")).toHaveCount(2);
});

test("records leave, saying first that nobody can be booked on those days", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await expect(page.getByText("Nobody can be booked or assigned on these days")).toBeVisible();

  const form = page.locator("form").first();
  await form.getByLabel("First day").fill("2027-10-12");
  await form.getByLabel("Last day").fill("2027-10-14");
  await form.getByLabel("Note (optional)").fill("Away");

  const sent = page.waitForRequest((request) => request.url().endsWith(LEAVE) && request.method() === "POST");
  await form.getByRole("button", { name: "Record it" }).click();
  expect((await sent).postDataJSON()).toEqual({ from: "2027-10-12", to: "2027-10-14", note: "Away" });
});

test("says so when the dates do not make a period, and records nothing", async ({ page }) => {
  await open(page, undefined, fails(400, "invalid_request"));
  await page.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  const form = page.locator("form").first();
  await form.getByLabel("First day").fill("2027-10-14");
  await form.getByLabel("Last day").fill("2027-10-12");
  await form.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByRole("alert")).toContainText("the last day cannot come before the first");
});

test("takes leave back, which lets those days be worked again", async ({ page }) => {
  await open(page);
  const sent = page.waitForRequest((request) => request.url().endsWith(CANCEL) && request.method() === "POST");
  await page.getByRole("button", { name: "Take back Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  await sent;
});

test("meets WCAG 2.2 AA with a roster, with a revoke open, and with the leave form open", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: PHONE }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  const recording = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(recording.violations.map((violation) => violation.id)).toEqual([]);
});

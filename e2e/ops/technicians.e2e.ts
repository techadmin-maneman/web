// Technicians (board D3): the roster, one row a technician, the jobs each has
// finished and how those ran, and a panel over it with the phones each has
// logged in on, with a revoke, and their leave. The API is answered from
// e2e/ops/fixtures.ts, since a local database has no technician until FSM's
// mirror has run and none has logged in. The clock is fixed to the day the
// fixture's leave is read against.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  fails,
  json,
  LEAVE_CANCELLED,
  LEAVE_RECORDED,
  TASKS_READ_ON,
  TECHNICIAN_WORK,
  TECHNICIANS,
  type Call,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const IMRAN = "88000000-0000-4000-8000-000000000001";
const SANDEEP = "88000000-0000-4000-8000-000000000002";
const REVOKE = `/api/technicians/${IMRAN}/devices/a41c09e27f3b/revoke` as const;
const LEAVE = `/api/technicians/${IMRAN}/leave` as const;
const CANCEL = `/api/technicians/${SANDEEP}/leave/89000000-0000-4000-8000-000000000001/cancel` as const;
const READ_ROSTER: Call = "GET /api/technicians";
const READ_WORK: Call = "GET /api/technicians/work";
const REVOKE_IT: Call = `POST ${REVOKE}`;
const RECORD_LEAVE: Call = `POST ${LEAVE}`;
const CANCEL_LEAVE: Call = `POST ${CANCEL}`;
const PHONE = "Revoke Chrome on Android · 7f3b of Imran Qureshi";

async function open(
  page: Page,
  revoke = json({ revoked_at: "2027-09-22T06:00:00.000Z" }),
  leave = json(LEAVE_RECORDED),
): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    [READ_ROSTER]: json(TECHNICIANS),
    [READ_WORK]: json(TECHNICIAN_WORK),
    [REVOKE_IT]: revoke,
    [RECORD_LEAVE]: leave,
    [CANCEL_LEAVE]: json(LEAVE_CANCELLED),
  });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

/** Opens a technician's panel from the roster, as ops do by their name. */
async function panelOf(page: Page, name: string) {
  await page.getByRole("button", { name: `${name}: phones and leave` }).click();
  const panel = page.getByRole("dialog", { name });
  await expect(panel).toBeVisible();
  return panel;
}

test("lists every active technician with the zone the board draws", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 40–65");
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("Sec 1–39");
  // A technician the mirror has no zone for reads as a gap, as the design's tables write one.
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("—");
});

// Each technician took some 270 px with his phones and leave beneath him: 34,000 px for 168 (OPS-11).
test("gives each technician one row of the board's height, however many phones and days off", async ({ page }) => {
  await open(page);
  for (const name of ["Imran Qureshi", "Sandeep Yadav", "Faizan Ali"]) {
    const box = await page.getByRole("row").filter({ hasText: name }).boundingBox();
    expect(box?.height, name).toBeLessThanOrEqual(35);
  }
  await expect(page.getByText("Chrome on Android")).toBeHidden();
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

// The board letters 1 h 48 m in oxblood, #8A3A2E, and leaves 1 h 31 m quiet, so a
// minute over the planned length is not a technician running over: the API says
// which run over, by the minutes ops set (technician_work.over_by).
test("letters an average that runs over in oxblood, and leaves one a minute over quiet", async ({ page }) => {
  await open(page);
  const oxblood = "rgb(138, 58, 46)"; // --error-on-paper
  const over = page.getByRole("row").filter({ hasText: "Faizan Ali" }).getByText("1 h 48 m");
  const near = page.getByRole("row").filter({ hasText: "Sandeep Yadav" }).getByText("1 h 31 m");
  await expect(over).toHaveCSS("color", oxblood);
  await expect(near).not.toHaveCSS("color", oxblood);
});

// A job that was done and never timed is not a job that took no time.
test("reads as a gap, never as a nought, when the phone timed none of the jobs", async ({ page }) => {
  const untimed = TECHNICIAN_WORK.technicians.map((each) => ({
    ...each,
    timed_jobs: 0,
    average_minutes: null,
    average_planned_minutes: null,
    runs_over: false,
  }));
  await answer(page, {
    [READ_ROSTER]: json(TECHNICIANS),
    [READ_WORK]: json({ ...TECHNICIAN_WORK, technicians: untimed }),
  });
  await page.goto("/technicians");

  const imran = page.getByRole("row").filter({ hasText: "Imran Qureshi" });
  await expect(imran).toContainText("48");
  await expect(imran).toContainText("—");
  await expect(imran).not.toContainText("0 m");
});

// Nothing records what a technician is trained for, so the board's fifth column
// holds leave instead, and the table says why (docs/open-points.md, item 59).
test("puts Leave where the board draws Skill, and says beneath the table why", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader", { name: "Skill" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Leave" })).toBeVisible();
  await expect(page.getByText("Nothing records what a technician is trained for")).toBeVisible();
  await expect(page.getByText("Jobs finished from 24 Jun 2027 to 22 Sep 2027.")).toBeVisible();
});

test("says in the roster when a technician's next leave begins, or that he is away today", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("From 2 Oct");

  await page.clock.setFixedTime(new Date("2027-10-03T05:00:00.000Z"));
  await page.reload();
  const away = page.getByRole("row").filter({ hasText: "Sandeep Yadav" }).getByText("Away");
  await expect(away).toBeVisible();
  // In the board's small capitals, not in sans capitals (VIS-23).
  await expect(away).toHaveCSS("font-variant-caps", "all-small-caps");
});

test("opens a technician's phones and leave in a panel that keeps the keyboard", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Imran Qureshi");
  await expect(panel.getByRole("heading", { name: "Phones" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Leave" })).toBeVisible();

  // Closing it hands the keyboard back to the name that opened it.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Imran Qureshi: phones and leave" })).toBeFocused();
});

// Every phone read "A phone" where the browser gave no label, so two could not be told apart (OPS-11).
test("names each phone by its browser and the end of its own ID, and says when one is revoked", async ({ page }) => {
  await open(page);
  const imran = await panelOf(page, "Imran Qureshi");
  await expect(imran.getByText("Chrome on Android · 7f3b")).toBeVisible();
  await expect(imran.getByText("last used 22 Sep 2027")).toBeVisible();
  await expect(imran.getByText("Revoked 5 Aug 2027")).toBeVisible();
  await imran.getByRole("button", { name: "Close" }).click();

  // A phone whose browser gave no label at login, and a technician who has logged in on none.
  const sandeep = await panelOf(page, "Sandeep Yadav");
  await expect(sandeep.getByText("Phone · 902d")).toBeVisible();
  await sandeep.getByRole("button", { name: "Close" }).click();
  const faizan = await panelOf(page, "Faizan Ali");
  await expect(faizan.getByText("No phone logged in.")).toBeVisible();
});

test("offers no revoke on a phone that is revoked already", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Imran Qureshi");
  await expect(panel.getByRole("button", { name: /^Revoke Safari on iPhone/ })).toBeHidden();
});

test("asks before it revokes a phone, and says what a revoke does", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: PHONE }).click();
  await expect(panel.getByText("The session ends, and the phone drops its cached jobs")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(REVOKE) && request.method() === "POST");
  await panel.getByRole("button", { name: "Revoke this phone" }).click();
  await sent;
  await expect(panel.getByText("Revoked 22 Sep 2027")).toBeVisible();
});

test("keeps the phone when the revoke is called off", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: PHONE }).click();
  await panel.getByRole("button", { name: "Keep it" }).click();
  await expect(panel.getByRole("button", { name: PHONE })).toBeVisible();
  await expect(panel.getByText("Revoked 22 Sep 2027")).toBeHidden();
});

test("says so when the phone is no longer that technician's", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: PHONE }).click();
  await panel.getByRole("button", { name: "Revoke this phone" }).click();
  await expect(panel.getByRole("alert")).toContainText("That phone is not this technician's any more.");
});

test("says so when the roster cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { [READ_ROSTER]: fails(503, "unavailable"), [READ_WORK]: json(TECHNICIAN_WORK) });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { [READ_ROSTER]: json(TECHNICIANS), [READ_WORK]: json(TECHNICIAN_WORK) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
});

// The table is one table, so a figure that did not load takes the roster with
// it rather than leaving a column of gaps that look like noughts.
test("says so when the figures cannot be loaded, and loads them on Try again", async ({ page }) => {
  await answer(page, { [READ_ROSTER]: json(TECHNICIANS), [READ_WORK]: fails(503, "unavailable") });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { [READ_ROSTER]: json(TECHNICIANS), [READ_WORK]: json(TECHNICIAN_WORK) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("1 h 48 m");
});

test("says so when no technician is active", async ({ page }) => {
  await answer(page, {
    [READ_ROSTER]: json({ technicians: [] }),
    [READ_WORK]: json({ ...TECHNICIAN_WORK, technicians: [] }),
  });
  await page.goto("/technicians");
  await expect(page.getByText("No technician is active.")).toBeVisible();
});

// Leave is recorded here because FSM has nowhere to keep it (ADR 0062), and it
// is the same rows the dispatch board reads, so it says what it does before it
// is sent.
test("lists the leave a technician is down for, and says when there is none", async ({ page }) => {
  await open(page);
  const sandeep = await panelOf(page, "Sandeep Yadav");
  await expect(sandeep.getByText("2 Oct 2027 to 6 Oct 2027")).toBeVisible();
  await expect(sandeep.getByText("Family wedding")).toBeVisible();
  await sandeep.getByRole("button", { name: "Close" }).click();
  const imran = await panelOf(page, "Imran Qureshi");
  await expect(imran.getByText("No leave recorded.")).toBeVisible();
});

test("records leave, saying first that nobody can be booked on those days, and shows it at once", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await expect(panel.getByText("Nobody can be booked or assigned on these days")).toBeVisible();
  // The form takes the keyboard as it opens, where the button stood.
  await expect(panel.getByLabel("First day")).toBeFocused();

  await panel.getByLabel("First day").fill("2027-10-12");
  await panel.getByLabel("Last day").fill("2027-10-14");
  await panel.getByLabel("Note (optional)").fill("Away");

  // The roster is read again, and the panel stays open over it with the leave in it.
  const recorded = {
    technicians: TECHNICIANS.technicians.map((each) =>
      each.id === IMRAN
        ? { ...each, leave: [{ id: LEAVE_RECORDED.id, from: "2027-10-12", to: "2027-10-14", note: "Away" }] }
        : each,
    ),
  };
  // The newest answers are tried first and pass nothing on, so this one answers the leave as well.
  await answer(page, { [READ_ROSTER]: json(recorded), [RECORD_LEAVE]: json(LEAVE_RECORDED) });
  const sent = page.waitForRequest((request) => request.url().endsWith(LEAVE) && request.method() === "POST");
  await panel.getByRole("button", { name: "Record it" }).click();
  expect((await sent).postDataJSON()).toEqual({ from: "2027-10-12", to: "2027-10-14", note: "Away" });
  await expect(panel.getByText("12 Oct 2027 to 14 Oct 2027")).toBeVisible();
});

// OPS-07: leave recorded over a job already booked moved it nowhere and said nothing.
test("lists the jobs already booked on the leave just recorded, with the way to move them", async ({ page }) => {
  const overJobs = {
    ...LEAVE_RECORDED,
    jobs: [
      {
        appointment_id: "22000000-0000-4000-8000-000000000001",
        starts_at: "2027-10-13T05:00:00.000Z",
        type: "service",
        client: "Rohit Malhotra",
      },
    ],
  };
  await open(page, undefined, json(overJobs));
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await panel.getByLabel("First day").fill("2027-10-12");
  await panel.getByLabel("Last day").fill("2027-10-14");
  await panel.getByRole("button", { name: "Record it" }).click();

  const stranded = panel.getByRole("status");
  await expect(stranded).toContainText("1 job is still booked on this leave. Recording it moved none.");
  await expect(stranded).toContainText("Wed 13 Oct, 10:30 am · Rohit Malhotra");
  await expect(stranded.getByRole("link", { name: "Move them on the dispatch board" })).toHaveAttribute(
    "href",
    "/dispatch",
  );
});

test("says so when the dates do not make a period, and records nothing", async ({ page }) => {
  await open(page, undefined, fails(400, "invalid_request"));
  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await panel.getByLabel("First day").fill("2027-10-14");
  await panel.getByLabel("Last day").fill("2027-10-12");
  await panel.getByRole("button", { name: "Record it" }).click();

  await expect(panel.getByRole("alert")).toContainText("the last day cannot come before the first");
});

test("takes leave back, which lets those days be worked again", async ({ page }) => {
  await open(page);
  const panel = await panelOf(page, "Sandeep Yadav");
  const sent = page.waitForRequest((request) => request.url().endsWith(CANCEL) && request.method() === "POST");
  await panel.getByRole("button", { name: "Take back Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  await sent;
});

test("meets WCAG 2.2 AA with a roster, with the panel, a revoke and the leave form open", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  const panel = await panelOf(page, "Imran Qureshi");
  await panel.getByRole("button", { name: PHONE }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);

  await panel.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  const recording = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(recording.violations.map((violation) => violation.id)).toEqual([]);
});

// Technicians (board D3): the roster, one row a technician, the jobs each has
// finished and how those ran; and each technician's own page, which the roster's
// names open: his details, then his week, leave, phones and kit, a tab at a time.
// The API is answered from e2e/ops/fixtures.ts, since a local database has no
// technician until one is added and none has logged in. The clock is fixed to
// the day the fixture's leave is read against.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  fails,
  json,
  LEAVE_CANCELLED,
  LEAVE_RECORDED,
  NO_LEAVE,
  RAVI,
  SANDEEP_LEAVE,
  STOCK,
  SWITCHED_OFF,
  TASKS_READ_ON,
  TECHNICIAN_ADDED,
  TECHNICIAN_WORK,
  TECHNICIANS,
  type Answer,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const IMRAN = "88000000-0000-4000-8000-000000000001";
const SANDEEP = "88000000-0000-4000-8000-000000000002";
const FAIZAN = "88000000-0000-4000-8000-000000000003";
const REVOKE = `/api/technicians/${IMRAN}/devices/a41c09e27f3b/revoke` as const;
const LEAVE = `/api/technicians/${IMRAN}/leave` as const;
const CANCEL = `/api/technicians/${SANDEEP}/leave/89000000-0000-4000-8000-000000000001/cancel` as const;
const READ_ROSTER: Call = "GET /api/technicians";
const READ_WORK: Call = "GET /api/technicians/work";
const READ_STOCK: Call = "GET /api/stock";
const IMRANS_LEAVE: Call = `GET ${LEAVE}`;
const SANDEEPS_LEAVE: Call = `GET /api/technicians/${SANDEEP}/leave`;
const FAIZANS_LEAVE: Call = `GET /api/technicians/${FAIZAN}/leave`;
const REVOKE_IT: Call = `POST ${REVOKE}`;
const RECORD_LEAVE: Call = `POST ${LEAVE}`;
const CANCEL_LEAVE: Call = `POST ${CANCEL}`;
const PHONE = "Revoke Chrome on Android · 7f3b of Imran Qureshi";
const INK = "rgb(22, 35, 58)"; // --ink, a primary button's own

/**
 * What the roster and each technician's page are answered with, and `changed` over them. A newer answer() passes
 * nothing on to an older one, so a spec that changes one answer midway sends the whole set again.
 */
function answersWith(changed: Answers = {}): Answers {
  return {
    [READ_ROSTER]: json(TECHNICIANS),
    [READ_WORK]: json(TECHNICIAN_WORK),
    [IMRANS_LEAVE]: json(NO_LEAVE),
    [SANDEEPS_LEAVE]: json(SANDEEP_LEAVE),
    [FAIZANS_LEAVE]: json(NO_LEAVE),
    [READ_STOCK]: json(STOCK),
    [REVOKE_IT]: json({ revoked_at: "2027-09-22T06:00:00.000Z" }),
    [RECORD_LEAVE]: json(LEAVE_RECORDED),
    [CANCEL_LEAVE]: json(LEAVE_CANCELLED),
    ...changed,
  };
}

async function open(page: Page, changed: Answers = {}): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, answersWith(changed));
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

/** Opens a technician's page from the roster by his name, on the tab named, or on his week. */
async function pageOf(page: Page, name: string, tab?: string) {
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  if (tab !== undefined) await page.getByRole("link", { name: tab, exact: true }).click();
  return page.getByRole("main");
}

/** Back to the roster from a technician's page. */
async function backToRoster(page: Page) {
  await page.getByRole("link", { name: "All technicians" }).click();
  await expect(page.getByRole("table")).toBeVisible();
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

// The roster was a card some 480 px wide in a page with room for far more.
test("lets the roster take the page's width", async ({ page }) => {
  await open(page);
  const table = await page.getByRole("table").boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(table?.width ?? 0).toBeGreaterThan((main?.width ?? 0) * 0.8);
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

// "AWAY" never said until when.
test("says in the roster when a technician's next leave begins, or until when he is away", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("From 2 Oct");

  await page.clock.setFixedTime(new Date("2027-10-03T05:00:00.000Z"));
  await page.reload();
  const away = page.getByRole("row").filter({ hasText: "Sandeep Yadav" }).getByText("Away to 6 Oct");
  await expect(away).toBeVisible();
  // In the board's small capitals, not in sans capitals (VIS-23).
  await expect(away).toHaveCSS("font-variant-caps", "all-small-caps");
});

// A technician off sick or a lost phone meant finding him in three sections, and the panel had no address.
test("opens a technician's own page from his name, a tab at a time, each at an address of its own", async ({
  page,
}) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi");
  await expect(page).toHaveURL(new RegExp(`/technicians/${IMRAN}$`));
  await expect(page).toHaveTitle("This week · Technicians · Mane Man operations");

  const tabs = main.getByRole("navigation", { name: "Imran Qureshi: his week, leave, phones and kit" });
  await expect(tabs.getByRole("link")).toHaveText(["This week", "Leave", "Phones", "Kit"]);
  await expect(tabs.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("link", { name: "Open his week on the board" })).toHaveAttribute(
    "href",
    "/dispatch?find=Imran+Qureshi",
  );

  await tabs.getByRole("link", { name: "Phones" }).click();
  await expect(page).toHaveURL(new RegExp(`/technicians/${IMRAN}/phones$`));
  await expect(main.getByText("Chrome on Android · 7f3b")).toBeVisible();

  // A tab's address opens it directly, as a link from anywhere would.
  await page.goto(`/technicians/${SANDEEP}/leave`);
  await expect(page.getByRole("heading", { level: 2, name: "Sandeep Yadav" })).toBeVisible();
  await expect(main.getByText("Family wedding")).toBeVisible();

  await backToRoster(page);
  await expect(page).toHaveURL(/\/technicians$/);
});

test("says so when the technician is not on the roster any more", async ({ page }) => {
  await open(page);
  await page.goto("/technicians/88000000-0000-4000-8000-000000000009");
  await expect(page.getByText("That technician is not on the roster any more.")).toBeVisible();
  await expect(page.getByRole("link", { name: "All technicians" })).toBeVisible();
});

// Every phone read "last used 2 Oct 2026": no time, and nothing said whether it was still signed in.
test("names each phone, says when it was last used, and whether it is signed in, signed out or revoked", async ({
  page,
}) => {
  await open(page);
  const imran = await pageOf(page, "Imran Qureshi", "Phones");
  const android = imran.getByRole("listitem").filter({ hasText: "Chrome on Android · 7f3b" });
  await expect(android).toContainText("Last used 22 Sep 2027, 10:30 am");
  await expect(android).toContainText("Signed in");
  const iphone = imran.getByRole("listitem").filter({ hasText: "Safari on iPhone" });
  await expect(iphone).toContainText("Revoked 5 Aug 2027");
  await expect(iphone).not.toContainText("Signed");
  await backToRoster(page);

  // A phone whose browser gave no label at login, signed out on its own, and a technician who has logged in on none.
  const sandeep = await pageOf(page, "Sandeep Yadav", "Phones");
  await expect(sandeep.getByRole("listitem").filter({ hasText: "Phone · 902d" })).toContainText("Signed out");
  await backToRoster(page);
  const faizan = await pageOf(page, "Faizan Ali", "Phones");
  await expect(faizan.getByText("No phone logged in.")).toBeVisible();
});

test("offers no revoke on a phone that is revoked already", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await expect(main.getByRole("button", { name: /^Revoke Safari on iPhone/ })).toBeHidden();
});

test("asks before it revokes a phone, and says what a revoke does", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  await expect(main.getByText("The session ends, and the phone drops its cached jobs")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(REVOKE) && request.method() === "POST");
  await main.getByRole("button", { name: "Revoke this phone" }).click();
  await sent;
  await expect(main.getByText("Revoked 22 Sep 2027")).toBeVisible();
});

test("keeps the phone when the revoke is called off", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  await main.getByRole("button", { name: "Keep it" }).click();
  await expect(main.getByRole("button", { name: PHONE })).toBeVisible();
  await expect(main.getByText("Revoked 22 Sep 2027")).toBeHidden();
});

test("says so when the phone is no longer that technician's", async ({ page }) => {
  await open(page, { [REVOKE_IT]: fails(404, "not_found") });
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  await main.getByRole("button", { name: "Revoke this phone" }).click();
  await expect(main.getByRole("alert")).toContainText("That phone is not this technician's any more.");
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
    [READ_ROSTER]: json({ ...TECHNICIANS, technicians: [], switched_off: [] }),
    [READ_WORK]: json({ ...TECHNICIAN_WORK, technicians: [] }),
  });
  await page.goto("/technicians");
  await expect(page.getByText("No technician is active.")).toBeVisible();
});

// ---- His kit ---------------------------------------------------------------------------------------------------

test("lists what his kit holds, marking what is low, with the way to Stock", async ({ page }) => {
  const kit = {
    ...STOCK,
    holdings: [
      { consumable_code: "tape_strips", technician_id: IMRAN, quantity: 3, low: true, counted_at: null },
      {
        consumable_code: "solvent",
        technician_id: IMRAN,
        quantity: 150,
        low: false,
        counted_at: "2027-09-20T06:00:00.000Z",
      },
      { consumable_code: "solvent", technician_id: SANDEEP, quantity: 40, low: false, counted_at: null },
    ],
  } satisfies OpsReply<"/api/stock">;
  await open(page, { [READ_STOCK]: json(kit) });
  const main = await pageOf(page, "Imran Qureshi", "Kit");

  const tape = main.getByRole("row").filter({ hasText: "Tape strips" });
  await expect(tape).toContainText("3 strip");
  await expect(tape).toContainText("Low");
  await expect(main.getByRole("row").filter({ hasText: "Solvent" })).toContainText("150 ml");
  await expect(main.getByRole("row").filter({ hasText: "Solvent" })).toContainText("Mon 20 Sep");
  await expect(main.getByText("40 ml")).toBeHidden();
  await expect(main.getByRole("link", { name: "Record a movement in Stock" })).toHaveAttribute("href", "/stock");
});

test("says so when his kit holds nothing on record", async ({ page }) => {
  await open(page, { [READ_STOCK]: json({ ...STOCK, holdings: [] }) });
  const main = await pageOf(page, "Faizan Ali", "Kit");
  await expect(main.getByText("Nothing in his kit on record.")).toBeVisible();
});

// ---- Leave ------------------------------------------------------------------------------------------------------

// Leave is recorded here because FSM has nowhere to keep it (ADR 0062), and it
// is the same rows the dispatch board reads, so it says what it does before it
// is sent.
test("lists the leave a technician is down for, and says when there is none", async ({ page }) => {
  await open(page);
  const sandeep = await pageOf(page, "Sandeep Yadav", "Leave");
  await expect(sandeep.getByText("2 Oct 2027 to 6 Oct 2027")).toBeVisible();
  await expect(sandeep.getByText("Family wedding")).toBeVisible();
  await backToRoster(page);
  const imran = await pageOf(page, "Imran Qureshi", "Leave");
  await expect(imran.getByText("No leave recorded.")).toBeVisible();
});

// Reopened after one of three jobs had been moved, the panel showed the leave and not the two jobs still on it.
test("lists the jobs still booked on a leave each time the tab opens, each with the way to it on the board", async ({
  page,
}) => {
  await open(page);
  const main = await pageOf(page, "Sandeep Yadav", "Leave");
  const stranded = () => main.getByRole("listitem").filter({ hasText: "2 Oct 2027 to 6 Oct 2027" });
  await expect(stranded()).toContainText("1 job is still booked on these days. Leave moves none.");
  await expect(stranded()).toContainText("Mon 4 Oct, 10:30 am · Rohit Malhotra");
  await expect(
    stranded().getByRole("link", { name: "Show on board: Mon 4 Oct, 10:30 am · Rohit Malhotra" }),
  ).toHaveAttribute("href", "/dispatch?from=2027-10-04&find=Sandeep+Yadav&visit=22000000-0000-4000-8000-000000000001");

  await main.getByRole("link", { name: "Phones", exact: true }).click();
  await main.getByRole("link", { name: "Leave", exact: true }).click();
  await expect(stranded()).toContainText("Mon 4 Oct, 10:30 am · Rohit Malhotra");
});

test("records leave, saying first that nobody can be booked on those days, and shows it at once", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Leave");
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await expect(main.getByText("Nobody can be booked or assigned on these days")).toBeVisible();
  // The form takes the keyboard as it opens, where the button stood.
  await expect(main.getByLabel("First day")).toBeFocused();
  // A routine entry, drawn as every other save is, not as a danger.
  await expect(main.getByRole("button", { name: "Record it" })).toHaveCSS("background-color", INK);

  await main.getByLabel("First day").fill("2027-10-12");
  await main.getByLabel("Last day").fill("2027-10-14");
  await main.getByLabel("Note (optional)").fill("Away");

  // His leave is read again, with the new period and the job it falls on.
  const recorded = {
    leave: [
      {
        id: LEAVE_RECORDED.id,
        from: "2027-10-12",
        to: "2027-10-14",
        note: "Away",
        jobs: [
          {
            appointment_id: "22000000-0000-4000-8000-000000000002",
            starts_at: "2027-10-13T05:00:00.000Z",
            type: "service",
            client: "Rohit Malhotra",
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/technicians/{id}/leave">;
  await answer(page, answersWith({ [IMRANS_LEAVE]: json(recorded) }));
  const sent = page.waitForRequest((request) => request.url().endsWith(LEAVE) && request.method() === "POST");
  await main.getByRole("button", { name: "Record it" }).click();
  expect((await sent).postDataJSON()).toEqual({ from: "2027-10-12", to: "2027-10-14", note: "Away" });

  await expect(main.getByRole("status")).toHaveText("Leave recorded.");
  const period = main.getByRole("listitem").filter({ hasText: "12 Oct 2027 to 14 Oct 2027" });
  await expect(period).toContainText("1 job is still booked on these days. Leave moves none.");
  await expect(period).toContainText("Wed 13 Oct, 10:30 am · Rohit Malhotra");
});

test("says so when the dates do not make a period, and records nothing", async ({ page }) => {
  await open(page, { [RECORD_LEAVE]: fails(400, "invalid_request") });
  const main = await pageOf(page, "Imran Qureshi", "Leave");
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  await main.getByLabel("First day").fill("2027-10-14");
  await main.getByLabel("Last day").fill("2027-10-12");
  await main.getByRole("button", { name: "Record it" }).click();

  await expect(main.getByRole("alert")).toContainText("the last day cannot come before the first");
});

// Taking leave back put a technician into the booking pool at once, with no check, unlike every other change.
test("takes leave back only once asked, saying he can be booked on those days again", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Sandeep Yadav", "Leave");
  const posted: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posted.push(request.url());
  });

  await main.getByRole("button", { name: "Take back Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  const check = main.getByRole("group", { name: "Take back leave, 2 Oct 2027 to 6 Oct 2027?" });
  await expect(check).toContainText("He can be booked again on those days.");
  await check.getByRole("button", { name: "Keep the leave" }).click();
  await expect(check).toBeHidden();
  expect(posted).toEqual([]);

  await main.getByRole("button", { name: "Take back Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  await answer(page, answersWith({ [SANDEEPS_LEAVE]: json(NO_LEAVE) }));
  const sent = page.waitForRequest((request) => request.url().endsWith(CANCEL) && request.method() === "POST");
  await main.getByRole("button", { name: "Take it back" }).click();
  await sent;
  await expect(main.getByText("No leave recorded.")).toBeVisible();
});

test("meets WCAG 2.2 AA on the roster and the page, with a revoke, the leave form and its check open", async ({
  page,
}) => {
  await open(page);
  const roster = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(roster.violations.map((violation) => violation.id)).toEqual([]);

  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);

  await main.getByRole("link", { name: "Leave", exact: true }).click();
  await main.getByRole("button", { name: "Record leave for Imran Qureshi" }).click();
  const recording = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(recording.violations.map((violation) => violation.id)).toEqual([]);

  await backToRoster(page);
  const sandeep = await pageOf(page, "Sandeep Yadav", "Leave");
  await sandeep.getByRole("button", { name: "Take back Sandeep Yadav's leave, 2 Oct 2027 to 6 Oct 2027" }).click();
  const checking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(checking.violations.map((violation) => violation.id)).toEqual([]);
});

// ---- Adding, changing and switching off a technician ---------------------------------------------------------

const ADD: Call = "POST /api/technicians";
const CHANGE: Call = `PATCH /api/technicians/${IMRAN}`;
const SWITCH_OFF: Call = `POST /api/technicians/${IMRAN}/deactivate`;
const SWITCH_ON: Call = `POST /api/technicians/${RAVI.id}/reactivate`;

type Roster = OpsReply<"/api/technicians">;

/** The roster as the API holds it: a spec swaps `current` as a change would change the API's own rows. */
function rosterOf(initial: Roster): { readonly roster: { current: Roster }; readonly reply: Answer } {
  const roster = { current: initial };
  return { roster, reply: (route) => json(roster.current)(route) };
}

async function openWith(page: Page, answers: Answers, roster: Answer = json(TECHNICIANS)): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { [READ_ROSTER]: roster, [READ_WORK]: json(TECHNICIAN_WORK), ...answers });
  await page.goto("/technicians");
  await expect(page.getByRole("heading", { level: 1, name: "Technicians" })).toBeVisible();
}

test("adds a technician, whose number signs in at once", async ({ page }) => {
  await openWith(page, { [ADD]: json(TECHNICIAN_ADDED, 201) });
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });
  await expect(form.getByText("His sign-in codes go to this number on WhatsApp")).toBeVisible();

  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("+91 98100 00007");
  await form.getByRole("textbox", { name: "Zone (optional)" }).fill("Sec 66–80");
  await form.getByRole("combobox", { name: "City" }).selectOption("Noida");
  const sent = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/technicians"));
  await form.getByRole("button", { name: "Add technician" }).click();

  expect((await sent).postDataJSON()).toEqual({
    name: "Naveen Rao",
    mobile: "9810000007",
    zone: "Sec 66–80",
    city: "Noida",
  });
  await expect(form).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Naveen Rao is added. He can sign in now.");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("refuses a number another active technician signs in with, and keeps what was typed", async ({ page }) => {
  await openWith(page, { [ADD]: fails(409, "number_in_use") });
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });
  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("98100 00001");
  await form.getByRole("button", { name: "Add technician" }).click();

  await expect(form.getByRole("alert")).toHaveText("Another active technician signs in with that number.");
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Naveen Rao");
});

test("asks for a mobile it can read before it sends anything", async ({ page }) => {
  await openWith(page, {});
  await page.getByRole("button", { name: "Add a technician" }).click();
  const form = page.getByRole("dialog", { name: "Add a technician" });
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(request.url());
  });
  await form.getByRole("textbox", { name: "Name" }).fill("Naveen Rao");
  await form.getByRole("textbox", { name: "Mobile" }).fill("12345");
  await form.getByRole("button", { name: "Add technician" }).click();

  await expect(form.getByRole("alert")).toHaveText("Enter a 10-digit Indian mobile.");
  expect(sent).toEqual([]);
});

test("changes a technician's details, sending only what changed", async ({ page }) => {
  const { roster, reply } = rosterOf(TECHNICIANS);
  await openWith(page, { [CHANGE]: json({ id: IMRAN }) }, reply);
  const main = await pageOf(page, "Imran Qureshi");
  await expect(main.getByText("+91 98100 00001")).toBeVisible();

  await main.getByRole("button", { name: "Change Imran Qureshi's details" }).click();
  await main.getByRole("textbox", { name: "Zone (optional)" }).fill("Sec 1–39");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  roster.current = {
    ...TECHNICIANS,
    technicians: TECHNICIANS.technicians.map((each) => (each.id === IMRAN ? { ...each, zone: "Sec 1–39" } : each)),
  };
  await main.getByRole("button", { name: "Save changes" }).click();

  expect((await sent).postDataJSON()).toEqual({ zone: "Sec 1–39" });
  await expect(main.getByRole("button", { name: "Save changes" })).toBeHidden();
  await backToRoster(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 1–39");
});

test("moves a technician to another city, or to none", async ({ page }) => {
  await openWith(page, { [CHANGE]: json({ id: IMRAN }) });
  const main = await pageOf(page, "Imran Qureshi");
  await expect(main.getByRole("definition").filter({ hasText: "Gurgaon" })).toBeVisible();

  await main.getByRole("button", { name: "Change Imran Qureshi's details" }).click();
  const city = main.getByRole("combobox", { name: "City" });
  await expect(city).toHaveValue("Gurgaon");
  await city.selectOption("No city");
  const sent = page.waitForRequest((request) => request.method() === "PATCH");
  await main.getByRole("button", { name: "Save changes" }).click();

  expect((await sent).postDataJSON()).toEqual({ city: null });
});

test("switches a technician off only once asked, and lists the visits he no longer holds", async ({ page }) => {
  const { roster, reply } = rosterOf(TECHNICIANS);
  await openWith(page, { [SWITCH_OFF]: json(SWITCHED_OFF) }, reply);
  const main = await pageOf(page, "Imran Qureshi");

  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();
  await expect(main.getByText("He is signed out at once and cannot sign in.")).toBeVisible();
  await main.getByRole("button", { name: "Keep him on" }).click();
  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();

  roster.current = {
    ...TECHNICIANS,
    technicians: TECHNICIANS.technicians.filter((each) => each.id !== IMRAN),
    switched_off: [
      { id: IMRAN, name: "Imran Qureshi", zone: "Sec 40–65", city: "Gurgaon", mobile: "+919810000001", editable: true },
    ],
  };
  await main.getByRole("button", { name: "Switch him off" }).click();

  const returned = main.getByRole("status");
  await expect(returned).toContainText("2 visits are back on the dispatch board, for someone else.");
  await expect(returned).toContainText("Fri 24 Sep, 10 am · Rohit Malhotra");
  await expect(returned).toContainText("No client on our records");
  await expect(returned.getByRole("link", { name: "Give them out on the dispatch board" })).toHaveAttribute(
    "href",
    "/dispatch",
  );
  await expect(main.getByRole("button", { name: "Switch Imran Qureshi back on" })).toBeVisible();
  // Switched off, he has no phone signed in and no leave to record: his page is his details alone.
  await expect(main.getByRole("navigation", { name: /^Imran Qureshi:/ })).toBeHidden();
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // He is off the roster's table, and listed apart.
  await backToRoster(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Switched off" })).toContainText("Imran Qureshi");
});

test("lists the technicians switched off apart, and switches one back on", async ({ page }) => {
  const { roster, reply } = rosterOf({ ...TECHNICIANS, switched_off: [RAVI] });
  await openWith(page, { [SWITCH_ON]: json({ active: true }) }, reply);
  const off = page.getByRole("region", { name: "Switched off" });
  await expect(off).toContainText("Ravi Kumar");
  await expect(page.getByRole("row").filter({ hasText: "Ravi Kumar" })).toHaveCount(0);

  const main = await pageOf(page, "Ravi Kumar");
  await expect(main.getByRole("navigation", { name: /^Ravi Kumar:/ })).toBeHidden();
  roster.current = {
    ...TECHNICIANS,
    technicians: [...TECHNICIANS.technicians, { ...RAVI, initials: "RK", devices: [], leave: [] }],
    switched_off: [],
  };
  await main.getByRole("button", { name: "Switch Ravi Kumar back on" }).click();

  await expect(main.getByRole("status")).toContainText("Ravi Kumar can sign in again.");
  await expect(main.getByRole("navigation", { name: /^Ravi Kumar:/ })).toBeVisible();
  await backToRoster(page);
  await expect(off).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: "Ravi Kumar" })).toBeVisible();
});

test("says so when the number he signs in with is another's now", async ({ page }) => {
  await openWith(page, { [SWITCH_ON]: fails(409, "number_in_use") }, json({ ...TECHNICIANS, switched_off: [RAVI] }));
  const main = await pageOf(page, "Ravi Kumar");
  await main.getByRole("button", { name: "Switch Ravi Kumar back on" }).click();

  await expect(main.getByRole("alert")).toHaveText(
    "Another active technician signs in with his number now. Change one of the two numbers first.",
  );
});

// While FSM is the record of field work, its sync writes over every technician it lists.
test("leaves a technician FSM lists to FSM: no change and no switch off here", async ({ page }) => {
  const fsms = {
    ...TECHNICIANS,
    technicians: TECHNICIANS.technicians.map((each) => ({ ...each, editable: each.id !== IMRAN })),
  };
  await openWith(page, {}, json(fsms));
  const main = await pageOf(page, "Imran Qureshi");

  await expect(main.getByText("His details come from Zoho FSM. Change them there.")).toBeVisible();
  await expect(main.getByRole("button", { name: /^Change / })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^Switch off/ })).toHaveCount(0);
});

test("says plainly when the person's access does not reach a switch", async ({ page }) => {
  await openWith(page, { [SWITCH_OFF]: fails(403, "not_permitted") });
  const main = await pageOf(page, "Imran Qureshi");
  await main.getByRole("button", { name: "Switch off Imran Qureshi" }).click();
  await main.getByRole("button", { name: "Switch him off" }).click();

  await expect(main.getByRole("alert")).toHaveText("Your access doesn't include this. Ask an admin.");
});

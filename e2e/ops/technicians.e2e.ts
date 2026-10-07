import { expect, test } from "../support.ts";
import { answer, fails, json, TECHNICIAN_WORK, TECHNICIANS } from "./fixtures.ts";
import {
  IMRAN,
  SANDEEP,
  REVOKE,
  READ_ROSTER,
  READ_WORK,
  REVOKE_IT,
  PHONE,
  open,
  pageOf,
  backToRoster,
} from "./technicians-fixtures.ts";

test("lists every active technician with the zone the board draws", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Imran Qureshi" })).toContainText("Sec 40–65");
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("Sec 1–39");
  // A technician the mirror has no zone for reads as a gap, as the design's tables write one.
  await expect(page.getByRole("row").filter({ hasText: "Faizan Ali" })).toContainText("—");
});

test("sorts the roster by a column, and narrows it by zone or a search", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("table").getByRole("row");
  const byName = page.getByRole("button", { name: "Technician", exact: true });
  await byName.click();
  await expect(page.getByRole("columnheader", { name: "Technician" })).toHaveAttribute("aria-sort", "ascending");
  await expect(rows.nth(1)).toContainText("Faizan Ali");
  await byName.click();
  await expect(rows.nth(1)).toContainText("Sandeep Yadav");

  await page.getByLabel("Zone").selectOption("Sec 40–65");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Imran Qureshi");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByLabel("Search").fill("sandeep");
  await expect(rows).toHaveCount(2);
});

// Each technician took some 270 px with their phones and leave beneath them: 34,000 px for 168.
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
// holds leave instead (docs/open-points.md, item 59). The design note that said so
// beneath the table was ours, not ops', and is gone.
test("puts Leave where the board draws Skill, with no design note beneath the table", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("columnheader", { name: "Skill" })).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "Leave" })).toBeVisible();
  await expect(page.getByText("Nothing records what a technician is trained for")).toBeHidden();
  await expect(page.getByText("Jobs finished 24 Jun 2027 to 22 Sep 2027.")).toBeVisible();
});

// "AWAY" never said until when.
test("says in the roster when a technician's next leave begins, or until when he is away", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("row").filter({ hasText: "Sandeep Yadav" })).toContainText("From 2 Oct");

  await page.clock.setFixedTime(new Date("2027-10-03T05:00:00.000Z"));
  await page.reload();
  const away = page.getByRole("row").filter({ hasText: "Sandeep Yadav" }).getByText("Away to 6 Oct");
  await expect(away).toBeVisible();
  // In the board's small capitals, not in sans capitals.
  await expect(away).toHaveCSS("font-variant-caps", "all-small-caps");
});

// A technician off sick or a lost phone meant finding them in three sections, and the panel had no address.
test("opens a technician's own page from his name, a tab at a time, each at an address of its own", async ({
  page,
}) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi");
  await expect(page).toHaveURL(new RegExp(`/technicians/${IMRAN}$`));
  await expect(page).toHaveTitle("This week · Technicians · Mane Man operations");

  const tabs = main.getByRole("navigation", { name: "Imran Qureshi: week, leave, phones and kit" });
  await expect(tabs.getByRole("link")).toHaveText(["This week", "Leave", "Phones", "Kit"]);
  await expect(tabs.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByRole("link", { name: "Open on the board" })).toHaveAttribute(
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
  await expect(page.getByText("No longer on the roster.")).toBeVisible();
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
  await expect(faizan.getByText("No phones signed in.")).toBeVisible();
});

// A revoke stops them signing in on any phone, since their code reaches the lost phone too; ops let them back.
test("says when a revoke stopped him signing in, and lets him in again", async ({ page }) => {
  const [imran, ...others] = TECHNICIANS.technicians;
  const stopped = {
    ...TECHNICIANS,
    technicians: [{ ...imran, sign_in_stopped_at: "2027-08-05T05:00:00.000Z" }, ...others],
  };
  await open(page, {
    [READ_ROSTER]: json(stopped),
    [`POST /api/technicians/${IMRAN}/allow-sign-in`]: json({ allowed: true }),
  });
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await expect(main.getByText("Sign-in blocked since 5 Aug 2027, when a phone was revoked.")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(`/api/technicians/${IMRAN}/allow-sign-in`));
  await main.getByRole("button", { name: "Allow sign-in" }).click();
  await sent;
  await expect(main.getByRole("status")).toHaveText("They can sign in again.");
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
  await expect(main.getByText("Signs the phone out.")).toBeVisible();

  const sent = page.waitForRequest((request) => request.url().endsWith(REVOKE) && request.method() === "POST");
  await main.getByRole("button", { name: "Revoke this phone" }).click();
  await sent;
  await expect(main.getByText("Revoked 22 Sep 2027")).toBeVisible();
});

test("keeps the phone when the revoke is called off", async ({ page }) => {
  await open(page);
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  await main.getByRole("button", { name: "Cancel" }).click();
  await expect(main.getByRole("button", { name: PHONE })).toBeVisible();
  await expect(main.getByText("Revoked 22 Sep 2027")).toBeHidden();
});

test("says so when the phone is no longer that technician's", async ({ page }) => {
  await open(page, { [REVOKE_IT]: fails(404, "not_found") });
  const main = await pageOf(page, "Imran Qureshi", "Phones");
  await main.getByRole("button", { name: PHONE }).click();
  await main.getByRole("button", { name: "Revoke this phone" }).click();
  await expect(main.getByRole("alert")).toContainText("That phone is no longer theirs.");
});

test("says so when the roster cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { [READ_ROSTER]: fails(503, "unavailable"), [READ_WORK]: json(TECHNICIAN_WORK) });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("Couldn't load this.");

  await answer(page, { [READ_ROSTER]: json(TECHNICIANS), [READ_WORK]: json(TECHNICIAN_WORK) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Imran Qureshi")).toBeVisible();
});

// The table is one table, so a figure that did not load takes the roster with
// it rather than leaving a column of gaps that look like noughts.
test("says so when the figures cannot be loaded, and loads them on Try again", async ({ page }) => {
  await answer(page, { [READ_ROSTER]: json(TECHNICIANS), [READ_WORK]: fails(503, "unavailable") });
  await page.goto("/technicians");
  await expect(page.getByRole("alert")).toContainText("Couldn't load this.");

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
  await expect(page.getByText("No active technicians.")).toBeVisible();
});

// Technician pay, under Finance (docs/decisions/0122-technician-pay-per-visit.md), which no board draws. A grade's
// row opens its record, where its name and its rates change where they read (docs/decisions/0212-editing-in-place.md).
// Every name and figure is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, type Answer, type OpsReply } from "./answer.ts";
import { states } from "../../packages/ui/words.ts";
import { shortDate } from "../../packages/web-kit/dates.ts";
import { chooseCity, signedInLocally } from "./fixtures/whoami.ts";
import { deleting, EDITING } from "../../apps/ops/src/content/common.ts";
import { technicianPay as copy } from "../../apps/ops/src/content/technician-pay.ts";
import { settingsPageNames, shell } from "../../apps/ops/src/content.ts";

const SENIOR = "5f8a6c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const TRAINEE = "6a9b7d2f-3c4e-4f6a-9b0c-1d2e3f4a5b6c";

const PAY: OpsReply<"/api/technician-pay"> = {
  today: "2026-09-21",
  kinds: ["consultation", "one_visit", "first_fit", "service", "replacement", "no_show"],
  cities: ["Gurgaon", "Delhi"],
  max_amount: 1000000,
  grades: [
    { id: SENIOR, name: "Senior", technicians: 1 },
    { id: TRAINEE, name: "Trainee", technicians: 0 },
  ],
  technicians: [
    { id: "t1", name: "Test technician One", city: "Delhi", grade_id: SENIOR },
    { id: "t2", name: "Test technician Two", city: null, grade_id: null },
  ],
  rates: [
    rate({ grade_id: SENIOR, kind: "service", amount: 30000, effective_from: "2026-09-01" }),
    rate({ grade_id: SENIOR, kind: "service", amount: 35000, effective_from: "2026-10-01" }),
    rate({ grade_id: SENIOR, kind: "service", amount: 40000, effective_from: "2026-09-10", city: "Delhi" }),
    rate({ grade_id: SENIOR, kind: "first_fit", amount: 100000, effective_from: "2026-09-01" }),
  ],
  rate_history: [
    rate({ grade_id: SENIOR, kind: "service", amount: 35000, effective_from: "2026-10-01" }),
    rate({ grade_id: SENIOR, kind: "service", amount: 40000, effective_from: "2026-09-10", city: "Delhi" }),
    rate({ grade_id: SENIOR, kind: "service", amount: 30000, effective_from: "2026-09-01" }),
    rate({ grade_id: SENIOR, kind: "first_fit", amount: 100000, effective_from: "2026-09-01" }),
    rate({ grade_id: SENIOR, kind: "service", amount: 25000, effective_from: "2026-06-01" }),
  ],
  grade_history: [
    {
      technician_id: "t1",
      grade_id: SENIOR,
      effective_from: "2026-08-01",
      set_by: "finance@maneman.in",
      set_at: "2026-07-30T05:00:00.000Z",
    },
    {
      technician_id: "t1",
      grade_id: TRAINEE,
      effective_from: "2000-01-01",
      set_by: "migration 0238",
      set_at: "2026-11-24T05:00:00.000Z",
    },
  ],
};

function rate(set: {
  grade_id: string;
  kind: OpsReply<"/api/technician-pay">["rates"][number]["kind"];
  amount: number | null;
  effective_from: string;
  city?: string;
}): OpsReply<"/api/technician-pay">["rates"][number] {
  return { city: null, set_by: "finance@maneman.test", set_at: "2026-09-01T06:30:00.000Z", ...set };
}

/** August's pay: Test technician One's service visits at a rate, and a replacement no rate covered. */
const STATEMENT = {
  month: "2026-08",
  lines: [
    {
      technician_id: "t1",
      technician: "Test technician One",
      city: "Delhi",
      kind: "service",
      visits: 12,
      rate: 40_000,
      amount: 480_000,
    },
    {
      technician_id: "t1",
      technician: "Test technician One",
      city: "Delhi",
      kind: "replacement",
      visits: 1,
      rate: null,
      amount: null,
    },
  ],
} satisfies OpsReply<"/api/technician-pay/statement">;

/** Settings' Pay grades, where the grades and their rates are set. */
async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await answer(page, {
    "GET /api/technician-pay": json(PAY),
    "GET /api/technician-pay/statement": json(STATEMENT),
    ...extra,
  });
  await page.goto("/settings/pay-grades");
  await expect(page.getByRole("heading", { level: 1, name: settingsPageNames["pay-grades"] })).toBeVisible();
}

const cellsOf = (page: Page, grade: string) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: copy.rates.open(grade), exact: true }) })
    .getByRole("cell");

async function recordOf(page: Page, name: string) {
  await page.getByRole("button", { name: copy.rates.open(name), exact: true }).click();
  return page.getByRole("dialog", { name });
}

test("lists the grades and each one’s rates, every city’s first, then the header city’s own", async ({ page }) => {
  await open(page, { "GET /api/whoami": signedInLocally(["Gurgaon", "Delhi"]) });
  await expect(cellsOf(page, "Senior")).toHaveText([
    "1",
    "—",
    "—",
    "Rs. 1,000",
    "Rs. 300Rs. 350 from Thu 1 Oct",
    "—",
    "—",
  ]);
  await chooseCity(page, "Delhi");
  await expect(cellsOf(page, "Senior").nth(3)).toHaveText("Rs. 1,000 (every city)");
  await expect(cellsOf(page, "Senior").nth(4)).toHaveText("Rs. 400");
});

test("sets a rate from a date, in rupees, for every city, where it reads", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/technician-pay/rates": (route) => {
      sent = route.request().postDataJSON();
      return json(PAY)(route);
    },
  });
  const record = await recordOf(page, "Trainee");
  await expect(record).toContainText(copy.form.ratesIn(null));
  await record.getByRole("button", { name: `${EDITING.change} ${copy.kinds.replacement}` }).click();
  const amount = record.getByRole("textbox", { name: copy.kinds.replacement });
  await expect(record.getByLabel(copy.form.from)).toHaveValue("2026-09-21");
  await amount.fill("450");
  await record.getByLabel(copy.form.from).fill("2026-10-01");
  await amount.press("Enter");
  await expect(record.getByRole("status")).toHaveText(EDITING.saved);
  expect(sent).toEqual({ grade_id: TRAINEE, city: null, kind: "replacement", amount: 45000, from: "2026-10-01" });
});

test("renames a grade where its name reads", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "PATCH /api/technician-pay/grades/{id}": (route) => {
      sent = route.request().postDataJSON();
      return json(PAY)(route);
    },
  });
  const record = await recordOf(page, "Senior");
  await record.getByRole("button", { name: `${EDITING.change} ${copy.form.name}` }).click();
  const name = record.getByRole("textbox", { name: copy.form.name });
  await name.fill("Lead");
  await name.press("Enter");
  await expect.poll(() => sent).toEqual({ name: "Lead" });
});

test("shows last month’s pay a row each technician, says what no rate covered, and gives it as a CSV", async ({
  page,
}) => {
  await answer(page, {
    "GET /api/technician-pay": json(PAY),
    "GET /api/technician-pay/statement": json(STATEMENT),
  });
  await page.goto("/technician-pay");
  await expect(page.getByRole("heading", { level: 1, name: shell.sections["technician-pay"] })).toBeVisible();
  // Beside the title, above the month's own choice, which names it too.
  await expect(
    page.getByRole("main").getByText(copy.statement.monthHead("2026-08", false), { exact: true }).first(),
  ).toBeVisible();
  const panel = page.getByRole("region", { name: copy.statement.title });
  await expect(panel.getByRole("combobox", { name: copy.statement.month })).toHaveValue("2026-08");
  // A row each technician, as the redesign draws it: their grade, their visits by kind, and their pay.
  await expect(panel.getByRole("columnheader")).toHaveText([
    copy.statement.technician,
    copy.statement.grade,
    copy.statement.kindHeads.service,
    copy.statement.kindHeads.replacement,
    copy.statement.amount,
  ]);
  const one = panel.getByRole("row").filter({ hasText: "Test technician One" });
  await expect(one).toContainText("Senior");
  await expect(one).toContainText("12");
  await expect(one).toContainText("Rs. 4,800");
  await expect(one).toContainText(copy.statement.unpriced);
  await expect(panel.getByRole("row").last()).toContainText(copy.statement.totalOf(1));

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: copy.statement.download }).click();
  expect((await download).suggestedFilename()).toBe("technician-pay-2026-08.csv");
});

test("names a technician with no pay grade above the month, with the way to set one", async ({ page }) => {
  await answer(page, {
    "GET /api/technician-pay": json(PAY),
    "GET /api/technician-pay/statement": json(STATEMENT),
  });
  await page.goto("/technician-pay");
  await expect(page.getByText(copy.statement.ungraded(["Test technician Two"]))).toBeVisible();
  await expect(page.getByRole("link", { name: copy.statement.setGrades })).toHaveAttribute(
    "href",
    "/settings/pay-grades",
  );
});

/** Money's Technician pay, its statement answered as given. */
async function statement(page: Page, read: Answer) {
  await answer(page, { "GET /api/technician-pay": json(PAY), "GET /api/technician-pay/statement": read });
  await page.goto("/technician-pay");
}

test("opens a technician's pay by visit, by city and rate, a visit no rate covered said so", async ({ page }) => {
  await statement(page, json(STATEMENT));
  await page.getByRole("button", { name: copy.statement.openLabel("Test technician One") }).click();
  const lines = page.getByRole("dialog", { name: "Test technician One" });
  const service = lines.getByRole("row").filter({ hasText: copy.kinds.service });
  await expect(service).toContainText("Delhi");
  await expect(service).toContainText("Rs. 400");
  await expect(service).toContainText("Rs. 4,800");
  await expect(lines.getByRole("row").filter({ hasText: copy.kinds.replacement })).toContainText(copy.statement.noRate);
});

// The month priced a switched-off technician's visits on their grade then; the grades list only those working now.
test("gives no warning for a technician switched off since the month", async ({ page }) => {
  const gone = {
    ...STATEMENT,
    lines: [
      {
        technician_id: "t9",
        technician: "Test technician Gone",
        city: "Delhi",
        kind: "service",
        visits: 12,
        rate: 40_000,
        amount: 480_000,
      },
    ],
  } satisfies OpsReply<"/api/technician-pay/statement">;
  await statement(page, json(gone));
  const row = page.getByRole("region", { name: copy.statement.title }).getByRole("row").filter({
    hasText: "Test technician Gone",
  });
  await expect(row).toContainText("Rs. 4,800");
  await expect(row).not.toContainText(copy.technicians.noGrade);
});

test("says so when no visit closed in the month", async ({ page }) => {
  await statement(page, json({ month: "2026-08", lines: [] }));
  await expect(page.getByRole("region", { name: copy.statement.title })).toContainText(copy.statement.none);
  await expect(page.getByRole("button", { name: copy.statement.download })).toHaveCount(0);
});

test("holds the month's room while it is read, and says so when it cannot be read", async ({ page }) => {
  await statement(page, async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    return fails(503, "unavailable")(route);
  });
  const panel = page.getByRole("region", { name: copy.statement.title });
  await expect(panel.getByText(states.loading)).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText(states.failed);

  await answer(page, { "GET /api/technician-pay/statement": json(STATEMENT) });
  await panel.getByRole("button", { name: states.retry }).click();
  await expect(panel.getByRole("row").filter({ hasText: "Test technician One" })).toBeVisible();
});

test("adds a grade, and gives a technician one", async ({ page }) => {
  const posts: unknown[] = [];
  const keep = (route: Parameters<ReturnType<typeof json>>[0]) => {
    posts.push(route.request().postDataJSON());
    return json(PAY)(route);
  };
  await open(page, { "POST /api/technician-pay/grades": keep, "POST /api/technician-pay/technicians/{id}": keep });
  await page.getByRole("button", { name: copy.rates.addGrade }).click();
  const add = page.getByRole("group", { name: copy.form.addTitle });
  await add.getByRole("textbox", { name: copy.form.name, exact: true }).fill("Lead");
  await add.getByRole("button", { name: copy.form.add, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.saved);

  await page.getByRole("button", { name: copy.technicians.open("Test technician Two") }).click();
  const record = page.getByRole("dialog", { name: "Test technician Two" });
  await record.getByRole("button", { name: `${EDITING.change} ${copy.technicians.grade}` }).click();
  await record.getByRole("combobox", { name: copy.technicians.grade }).selectOption("Trainee");
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect.poll(() => posts).toEqual([{ name: "Lead" }, { grade_id: TRAINEE, from: PAY.today }]);
});

// A grade applies from a day (docs/decisions/0311-dated-technician-grades.md): a change to come shows beneath the grade
// held today, the technician's record lists the grades they held, and a grade's record every rate it was given.
test("gives a technician a grade from a later day, listing the grades they held and each grade's rates", async ({
  page,
}) => {
  const sent: unknown[] = [];
  const later = {
    technician_id: "t1",
    grade_id: TRAINEE,
    effective_from: "2026-10-01",
    set_by: "finance@maneman.in",
    set_at: "2026-09-20T05:00:00.000Z",
  };
  await open(page, {
    "GET /api/technician-pay": json({ ...PAY, grade_history: [later, ...PAY.grade_history] }),
    "POST /api/technician-pay/technicians/{id}": (route) => {
      sent.push(route.request().postDataJSON());
      return json(PAY)(route);
    },
  });
  const row = page.getByRole("row").filter({ hasText: "Test technician One" });
  await expect(row).toContainText(copy.grading.later("Trainee", shortDate("2026-10-01")));

  await page.getByRole("button", { name: copy.technicians.open("Test technician One") }).click();
  const record = page.getByRole("dialog", { name: "Test technician One" });
  const grades = record.getByRole("region", { name: copy.grading.history.title });
  await expect(grades.getByRole("row")).toHaveCount(4);
  await expect(grades).toContainText(copy.grading.always);
  await record.getByRole("button", { name: `${EDITING.change} ${copy.grading.grade}` }).click();
  await record.getByRole("combobox", { name: copy.grading.grade }).selectOption("Senior");
  await record.getByLabel(copy.grading.from).fill("2026-10-15");
  await record.getByRole("button", { name: EDITING.save }).click();
  await expect.poll(() => sent).toEqual([{ grade_id: SENIOR, from: "2026-10-15" }]);
  await page.keyboard.press("Escape");

  const senior = await recordOf(page, "Senior");
  await expect(senior.getByRole("region", { name: copy.rates.history.title }).getByRole("row")).toHaveCount(6);
});

test("deletes a grade no technician holds, and says why one in use stays", async ({ page }) => {
  await open(page, {
    "POST /api/technician-pay/grades/{id}/delete": json({ error: { code: "in_use", request_id: "r-1" } }, 409),
  });
  const senior = await recordOf(page, "Senior");
  await expect(senior.getByRole("button", { name: deleting.label("Senior") })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const trainee = await recordOf(page, "Trainee");
  await trainee.getByRole("button", { name: deleting.label("Trainee") }).click();
  await trainee.getByRole("button", { name: deleting.confirm, exact: true }).click();
  await expect(trainee.getByRole("alert")).toHaveText(copy.rates.inUse);
});

// Technician pay, under Finance (docs/decisions/0122-technician-pay-per-visit.md), which no board draws. A grade's
// row opens its record, where its name and its rates change where they read (docs/decisions/0212-editing-in-place.md).
// Every name and figure is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
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

test("lists the grades and each one’s rates, every city’s first, then a city’s own", async ({ page }) => {
  await open(page);
  await expect(cellsOf(page, "Senior")).toHaveText([
    "1",
    "—",
    "—",
    "Rs. 1,000",
    "Rs. 300Rs. 350 from Thu 1 Oct",
    "—",
    "—",
  ]);
  await page.getByLabel(copy.rates.city, { exact: true }).selectOption("Delhi");
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

test("shows last month’s pay at the rates per visit, says what no rate covered, and gives it as a CSV", async ({
  page,
}) => {
  await answer(page, {
    "GET /api/technician-pay": json(PAY),
    "GET /api/technician-pay/statement": json(STATEMENT),
  });
  await page.goto("/technician-pay");
  await expect(page.getByRole("heading", { level: 1, name: shell.sections["technician-pay"] })).toBeVisible();
  const panel = page.getByRole("region", { name: copy.statement.title });
  await expect(panel.getByRole("combobox", { name: copy.statement.month })).toHaveValue("2026-08");
  await expect(panel.getByRole("row").filter({ hasText: copy.kinds.service })).toContainText("Rs. 4,800");
  await expect(panel.getByRole("row").filter({ hasText: copy.kinds.replacement })).toContainText(copy.statement.noRate);
  await expect(panel).toContainText(copy.statement.totalUnpriced("Test technician One"));

  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: copy.statement.download }).click();
  expect((await download).suggestedFilename()).toBe("technician-pay-2026-08.csv");
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
  await expect.poll(() => posts).toEqual([{ name: "Lead" }, { grade_id: TRAINEE }]);
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

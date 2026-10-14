// Technician pay, under Finance (docs/decisions/0122-technician-pay-per-visit.md), which no board draws. Every name
// and figure is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { deleting, review } from "../../apps/ops/src/content/common.ts";
import { technicianPay as copy } from "../../apps/ops/src/content/technician-pay.ts";

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

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await answer(page, {
    "GET /api/technician-pay": json(PAY),
    "GET /api/technician-pay/statement": json(STATEMENT),
    ...extra,
  });
  await page.goto("/technician-pay");
  await expect(page.getByRole("heading", { level: 1, name: "Technician pay" })).toBeVisible();
}

const cellsOf = (page: Page, grade: string) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: grade, exact: true }) })
    .getByRole("cell");

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
    /^Set rate/,
  ]);
  await page.getByLabel(copy.rates.city, { exact: true }).selectOption("Delhi");
  await expect(cellsOf(page, "Senior").nth(3)).toHaveText("Rs. 1,000 (every city)");
  await expect(cellsOf(page, "Senior").nth(4)).toHaveText("Rs. 400");
});

test("sets a rate from a date, in rupees, for every city, once it is reviewed", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/technician-pay/rates": (route) => {
      sent = route.request().postDataJSON();
      return json(PAY)(route);
    },
  });
  await page.getByRole("button", { name: copy.rates.setRateLabel("Trainee") }).click();
  await page.getByLabel(copy.form.kind, { exact: true }).selectOption(copy.kinds.replacement);
  await page.getByLabel(copy.form.amount).fill("450");
  await page.getByLabel(copy.form.from, { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: review.next }).click();
  await expect(page.getByText("Trainee · Replacement · Every city: — → Rs. 450, from Thu 1 Oct")).toBeVisible();
  expect(sent).toBeNull();
  await page.getByRole("button", { name: review.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.saved);
  expect(sent).toEqual({ grade_id: TRAINEE, city: null, kind: "replacement", amount: 45000, from: "2026-10-01" });
});

test("shows last month’s pay at the rates per visit, says what no rate covered, and gives it as a CSV", async ({
  page,
}) => {
  await open(page);
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
  await page.getByRole("textbox", { name: copy.form.name, exact: true }).fill("Lead");
  await page.getByRole("button", { name: review.next }).click();
  await expect(page.getByText(copy.check.add("Lead"))).toBeVisible();
  await page.getByRole("button", { name: review.send }).click();
  await page.getByRole("button", { name: copy.technicians.changeLabel("Test technician Two") }).click();
  await page.getByLabel(copy.form.grade, { exact: true }).selectOption("Trainee");
  await page.getByRole("button", { name: review.next }).click();
  await expect(page.getByText(copy.check.grade("Test technician Two", "No grade", "Trainee"))).toBeVisible();
  await page.getByRole("button", { name: review.send }).click();
  await expect.poll(() => posts).toEqual([{ name: "Lead" }, { grade_id: TRAINEE }]);
});

test("deletes a grade no technician holds, and says why one in use stays", async ({ page }) => {
  await open(page, {
    "POST /api/technician-pay/grades/{id}/delete": json({ error: { code: "in_use", request_id: "r-1" } }, 409),
  });
  await expect(page.getByRole("button", { name: copy.rates.deleteLabel("Senior") })).toHaveCount(0);
  await page.getByRole("button", { name: copy.rates.deleteLabel("Trainee") }).click();
  await page.getByRole("button", { name: deleting.confirm, exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(copy.rates.inUse);
});

// Technician pay, under Finance (docs/decisions/0122-technician-pay-per-visit.md), which no board draws. Every name
// and figure is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
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

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await answer(page, { "GET /api/technician-pay": json(PAY), ...extra });
  await page.goto("/technician-pay");
  await expect(page.getByRole("heading", { level: 1, name: "Technician pay" })).toBeVisible();
}

const cellsOf = (page: Page, grade: string) =>
  page
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: grade, exact: true }) })
    .getByRole("cell");

test("lists the grades and each one's rates, every city's first, then a city's own", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Senior · 1 technician")).toBeVisible();
  await expect(cellsOf(page, "Senior")).toHaveText(["—", "—", "Rs. 1,000", "Rs. 300Rs. 350 from Thu 1 Oct", "—", "—"]);
  await page.getByLabel(copy.rates.showing).selectOption("Delhi");
  await expect(cellsOf(page, "Senior").nth(2)).toHaveText("Rs. 1,000 (every city)");
  await expect(cellsOf(page, "Senior").nth(3)).toHaveText("Rs. 400");
});

test("sets a rate from a date, in rupees, for every city", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/technician-pay/rates": (route) => {
      sent = route.request().postDataJSON();
      return json(PAY)(route);
    },
  });
  await page.getByLabel(copy.rates.set.grade, { exact: true }).selectOption("Trainee");
  await page.getByLabel(copy.rates.set.kind, { exact: true }).selectOption(copy.kinds.replacement);
  await page.getByLabel(copy.rates.set.amount).fill("450");
  await page.getByLabel(copy.rates.set.from, { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: copy.rates.set.save }).click();
  await expect(page.getByRole("status")).toHaveText(copy.rates.set.saved);
  expect(sent).toEqual({ grade_id: TRAINEE, city: null, kind: "replacement", amount: 45000, from: "2026-10-01" });
});

test("adds a grade, and gives a technician one", async ({ page }) => {
  const posts: unknown[] = [];
  const keep = (route: Parameters<ReturnType<typeof json>>[0]) => {
    posts.push(route.request().postDataJSON());
    return json(PAY)(route);
  };
  await open(page, { "POST /api/technician-pay/grades": keep, "POST /api/technician-pay/technicians/{id}": keep });
  await page.getByLabel(copy.grades.name).fill("Lead");
  await page.getByRole("button", { name: copy.grades.add, exact: true }).click();
  await page.getByLabel(copy.technicians.gradeOf("Test technician Two")).selectOption("Trainee");
  await expect.poll(() => posts).toEqual([{ name: "Lead" }, { grade_id: TRAINEE }]);
});

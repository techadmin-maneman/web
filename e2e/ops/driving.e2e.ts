// Reports › Driving (apps/ops/src/driving/DrivingScreen.tsx, docs/decisions/0294-learned-drive-times.md): the drives
// planned against taken and the learned drive times, readable and keyboard-whole on a desktop and on a phone, where
// each table scrolls inside its panel and the page never sideways.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, chooseCity, json, signedInLocally, type OpsReply } from "./fixtures.ts";
import { shell } from "../../apps/ops/src/content.ts";
import { driving as copy } from "../../apps/ops/src/content/driving.ts";

const WEEK = { period: "2026-09-14", drives: 6, planned_minutes: 180, actual_minutes: 204 };

const REPORT = {
  from: "2026-08-24",
  to: "2026-09-20",
  by_technician: [
    { ...WEEK, technician_id: "t-1", name: "Imran Qureshi", city: "Gurgaon" },
    { ...WEEK, technician_id: "t-2", name: "Sameer Khan", city: "Gurgaon", actual_minutes: 171 },
  ],
  by_city: [{ ...WEEK, city: "Gurgaon", drives: 12, planned_minutes: 360, actual_minutes: 375 }],
  factors: [
    { city: "Gurgaon", day_kind: "weekday", hour: 10, factor_pct: 140, drives: 24, in_use: true },
    { city: "Gurgaon", day_kind: "weekday", hour: 17, factor_pct: 165, drives: 21, in_use: true },
    { city: "Gurgaon", day_kind: "weekend", hour: 11, factor_pct: 90, drives: 3, in_use: false },
  ],
  learning: { use: "learned", min_drives: 20 },
} satisfies OpsReply<"/api/reports/driving">;

test.beforeEach(async ({ page }) => {
  await answer(page, { "GET /api/reports/driving": json(REPORT) });
});

for (const width of [1440, 390]) {
  test(`shows the drives and the learned times, and meets WCAG 2.2 AA, at ${String(width)} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/driving");
    await expect(page.getByRole("heading", { level: 1, name: shell.sections.driving })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Imran Qureshi" })).toBeVisible();
    await expect(page.getByRole("cell", { name: copy.signed(-9) })).toBeAttached();
    await expect(page.getByRole("heading", { name: copy.learned })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await axeViolations(page)).toEqual([]);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sideways).toBeLessThanOrEqual(0);
  });
}

test("asks for the report by day once it is chosen", async ({ page }) => {
  await page.goto("/driving");
  const asked = page.waitForRequest((request) => request.url().includes("/api/reports/driving?weeks=4&by=day"));
  await page.getByRole("radio", { name: copy.bys.day }).click();
  await asked;
});

test("keeps to the city picked in the header, with no list of cities of its own", async ({ page }) => {
  await answer(page, {
    "GET /api/whoami": signedInLocally(["Gurgaon", "Pune"]),
    "GET /api/reports/driving": json(REPORT),
  });
  await page.goto("/driving");
  const cityLists = page.getByRole("main").getByRole("combobox", { name: copy.columns.city, exact: true });
  await expect(cityLists).toHaveCount(3);
  const asked = page.waitForRequest((request) => request.url().includes("city=Gurgaon"));
  await chooseCity(page, "Gurgaon");
  await asked;
  await expect(page.getByRole("rowheader", { name: "Imran Qureshi" })).toBeVisible();
  await expect(cityLists).toHaveCount(0);
});

// Targets, under Admin (docs/decisions/0154-targets-and-reporting-access.md), which no board draws: a month's target for
// a city set where it reads, and one taken off by emptying it (docs/decisions/0212-editing-in-place.md). Every figure is
// made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { targets as copy } from "../../apps/ops/src/content/targets.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

type Month = OpsReply<"/api/targets">;

const SEPTEMBER: Month = {
  month: "2026-09",
  targets: [
    {
      month: "2026-09",
      city: "Gurgaon",
      measure: "new_clients",
      target: 40,
      set_by: "admin@maneman.test",
      set_at: "2026-09-01T05:00:00.000Z",
    },
  ],
  cities: ["Gurgaon", "Bengaluru"],
  measures: ["leads", "consultations", "new_clients", "active_clients", "revenue", "cac", "utilisation", "on_time"],
  first_month: "2025-09",
  last_month: "2027-09",
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await page.clock.setFixedTime(new Date("2026-09-21T06:30:00.000Z"));
  await answer(page, { "GET /api/targets": json(SEPTEMBER), ...extra });
  await page.goto("/settings/targets");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

test("sets a month’s target for a city, by measure", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/targets": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(SEPTEMBER)(route);
    },
  });
  await expect(page.getByRole("cell", { name: "40", exact: true })).toBeVisible();
  await page.getByRole("main").getByLabel(copy.city).selectOption("Bengaluru");
  await page.getByRole("button", { name: `${EDITING.change} ${copy.measures.revenue}` }).click();
  const revenue = page.getByRole("textbox", { name: copy.measures.revenue });
  await revenue.fill("500000");
  await revenue.press("Enter");
  await expect.poll(() => sent).toEqual({ month: "2026-09", city: "Bengaluru", measure: "revenue", target: 500000 });
});

test("takes a target off once its figure is emptied", async ({ page }) => {
  await open(page, { "POST /api/targets/remove": json({ ...SEPTEMBER, targets: [] }) });
  const change = page.getByRole("button", { name: `${EDITING.change} ${copy.measures.new_clients}` });
  await expect(change.locator("..")).toContainText("40");
  await change.click();
  const box = page.getByRole("textbox", { name: copy.measures.new_clients });
  await box.fill("");
  await box.press("Enter");
  await expect(page.getByText(copy.none)).toBeVisible();
});

type Progress = OpsReply<"/api/targets/progress">;

/** Gurgaon's September so far, made up; every other figure nothing to count by. */
const progressOf = (month: string, figures: Readonly<Record<string, number>>): Progress => ({
  month,
  progress: SEPTEMBER.measures.map((measure) => ({ city: "Gurgaon", measure, actual: figures[measure] ?? null })),
});

/** A measure's row on the city's panel, by its Change. */
const rowOf = (page: Page, measure: keyof typeof copy.measures) =>
  page
    .getByRole("button", { name: `${EDITING.change} ${copy.measures[measure]}` })
    .locator("xpath=ancestor::div[1]/..");

test("says beneath each measure how far the month has come, with a line towards a target set", async ({ page }) => {
  await open(page, {
    "GET /api/targets/progress": (route: Route) =>
      json(
        new URL(route.request().url()).searchParams.get("month") === "2026-08"
          ? progressOf("2026-08", { new_clients: 31 })
          : progressOf("2026-09", { leads: 612, new_clients: 9, cac: 3500 }),
      )(route),
  });
  // New clients has a target of 40: nine so far, its line a little filled, in the accent as it is below half.
  const newClients = rowOf(page, "new_clients");
  await expect(newClients).toContainText(copy.soFar("9"));
  await expect(newClients).toContainText(copy.target("40"));
  await expect(newClients.locator("progress")).toHaveJSProperty("value", 9 / 40);
  // Leads has no target, so its figure stands with no line; a cost never has one.
  await expect(rowOf(page, "leads")).toContainText(copy.soFar("612"));
  await expect(rowOf(page, "leads").locator("progress")).toHaveCount(0);
  await expect(rowOf(page, "cac")).toContainText(copy.soFar("3,500"));
  await expect(rowOf(page, "cac").locator("progress")).toHaveCount(0);
  // A measure with nothing to count by says nothing beneath its name.
  await expect(rowOf(page, "on_time")).not.toContainText("so far");
  // A month gone says what it came to.
  await answer(page, { "GET /api/targets": json({ ...SEPTEMBER, month: "2026-08" }) });
  await page.getByRole("main").getByLabel(copy.month).selectOption("2026-08");
  await expect(rowOf(page, "new_clients")).toContainText(copy.inMonth("31", "August 2026"));
});

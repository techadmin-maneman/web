// Targets, under Admin (docs/decisions/0154-targets-and-reporting-access.md), which no board draws: a month's target for
// a city set, and one taken off. Every figure is made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { targets as copy } from "../../apps/ops/src/content/targets.ts";

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
  await page.getByRole("button", { name: copy.setOne }).click();
  const form = page.getByRole("dialog", { name: copy.setOne });
  await form.getByLabel(copy.city).selectOption("Bengaluru");
  await form.getByLabel(copy.measure).selectOption("revenue");
  await form.getByRole("textbox", { name: copy.target }).fill("500000");
  await form.getByRole("button", { name: copy.set }).click();
  await expect.poll(() => sent).toEqual({ month: "2026-09", city: "Bengaluru", measure: "revenue", target: 500000 });
});

test("takes a target off", async ({ page }) => {
  await open(page, { "POST /api/targets/remove": json({ ...SEPTEMBER, targets: [] }) });
  await page.getByRole("button", { name: copy.removeLabel("Gurgaon", copy.measures.new_clients) }).click();
  await expect(page.getByText(copy.none)).toBeVisible();
});

// Operations · Supply plan (docs/decisions/0180-supply-plan.md): the latest draft's transfers and orders, each with the
// figures behind it, one approved at a changed quantity and one rejected with why; beneath, the forecast one city at a
// time with how right it was (docs/decisions/0183-forecast-accuracy.md), and the events calendar
// (docs/decisions/0182-the-events-calendar.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { supplyPlan as copy } from "../../apps/ops/src/content/supply-plan.ts";

const LOAN = {
  id: "pl-1",
  kind: "transfer" as const,
  consumable_code: "solvent",
  name: "Solvent",
  unit: "ml",
  city: "Gurgaon",
  from: "Delhi stockroom",
  to: "Gurgaon stockroom",
  supplier: null,
  proposed: 5,
  quantity: null,
  usable: 0,
  need: 10,
  safety: 5,
  state: "proposed" as const,
  reject_reason: null,
  po_number: null,
};

const ORDER = {
  ...LOAN,
  id: "pl-2",
  kind: "order" as const,
  city: null,
  from: null,
  to: null,
  supplier: "Kesh Supplies",
  proposed: 24,
};

const PLAN = { lines: [LOAN, ORDER] } satisfies OpsReply<"/api/supply-plan">;

const WEDDINGS = {
  id: "ev-1",
  name: "Wedding season",
  city: "Gurgaon",
  starts_on: "2026-11-01",
  ends_on: "2026-11-30",
  uplift_percent: 25,
};
const CALENDAR = { events: [WEDDINGS], cities: ["Gurgaon", "Delhi"] } satisfies OpsReply<"/api/demand-events">;

const FORECAST = {
  run: { run_on: "2026-09-21", period_days: 7, horizon_periods: 2, due_rate: 0.8, fit_rate: 0.5 },
  lines: [0, 1].map((period) => ({
    consumable_code: "solvent",
    name: "Solvent",
    city: "Gurgaon",
    period,
    booked: 10,
    due: 0,
    pipeline: 0,
    baseline: 2,
    expected: 12,
    high: 15,
  })),
} satisfies OpsReply<"/api/stock/forecast">;

const ACCURACY = {
  periods: [
    {
      period_start: "2026-09-14",
      period_days: 7,
      expected: 13,
      actual: 14,
      error_percent: 50,
      bias_percent: -7,
      within_high_percent: 67,
    },
  ],
  items: [
    { consumable_code: "solvent", name: "Solvent", expected: 10, actual: 12, error_percent: 17, bias_percent: -17 },
  ],
} satisfies OpsReply<"/api/stock/forecast-accuracy">;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, {
    "GET /api/supply-plan": json(PLAN),
    "GET /api/demand-events": json(CALENDAR),
    "GET /api/stock/forecast": json(FORECAST),
    "GET /api/stock/forecast-accuracy": json(ACCURACY),
    ...extra,
  });
  await page.goto("/supply-plan");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test("lists each transfer and order with why, and approves one at a changed quantity", async ({ page }) => {
  const approved = { lines: [{ ...LOAN, state: "approved" as const, quantity: 4 }, ORDER] };
  await open(page, { "POST /api/supply-plan/lines/{id}/approve": json(approved) });
  const transfers = page.getByRole("region", { name: copy.transfers });
  const row = transfers.getByRole("row").filter({ hasText: "Solvent" });
  await expect(row).toContainText("Delhi stockroom");
  await expect(row).toContainText(copy.why({ need: 10, safety: 5, usable: 0 }));
  await expect(page.getByRole("region", { name: copy.orders })).toContainText("Kesh Supplies");

  await row.getByLabel(copy.quantity("Solvent")).fill("4");
  const request = posted(page, "/api/supply-plan/lines/pl-1/approve");
  await row.getByRole("button", { name: copy.approve }).click();
  expect((await request).postDataJSON()).toEqual({ quantity: 4 });
  await expect(row).toContainText(copy.states.approved);
  expect(await axeViolations(page)).toEqual([]);
});

test("says a forecast every period of which is over is out of date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-15T06:00:00.000Z"));
  await open(page);
  const forecast = page.getByRole("region", { name: copy.forecast.title });
  await expect(forecast).toContainText(copy.forecast.stale("21 Sep 2026"));
});

test("rejects a line with why", async ({ page }) => {
  const rejected = { lines: [LOAN, { ...ORDER, state: "rejected" as const, reject_reason: "Bought last week" }] };
  await open(page, { "POST /api/supply-plan/lines/{id}/reject": json(rejected) });
  const orders = page.getByRole("region", { name: copy.orders });
  await orders.getByRole("button", { name: copy.reject }).click();
  await orders.getByLabel(copy.why_label).fill("Bought last week");
  const request = posted(page, "/api/supply-plan/lines/pl-2/reject");
  await orders.getByRole("button", { name: copy.confirmReject }).click();
  expect((await request).postDataJSON()).toEqual({ reason: "Bought last week" });
  await expect(orders).toContainText("Rejected · Bought last week");
});

test("shows a city’s forecast, and adds an event to the calendar", async ({ page }) => {
  const diwali = {
    ...WEDDINGS,
    id: "ev-2",
    name: "Diwali",
    city: null,
    starts_on: "2026-11-08",
    ends_on: "2026-11-12",
  };
  // The forecast's second week: its first is over, so only the second is shown.
  await page.clock.setFixedTime(new Date("2026-09-29T06:00:00.000Z"));
  await open(page, { "POST /api/demand-events": json({ ...CALENDAR, events: [WEDDINGS, diwali] }) });
  const forecast = page.getByRole("region", { name: copy.forecast.title });
  await expect(forecast).toContainText(copy.forecast.note(7, "21 Sep 2026"));
  await expect(forecast.getByRole("columnheader", { name: "21 Sep" })).toHaveCount(0);
  await expect(forecast.getByRole("row").filter({ hasText: "Solvent" }).first()).toContainText(
    copy.forecast.high("15"),
  );
  await expect(forecast).toContainText(copy.accuracy.bias(-17));

  const events = page.getByRole("region", { name: copy.events.title });
  await expect(events).toContainText("Wedding season");
  await events.getByLabel(copy.events.name, { exact: true }).fill("Diwali");
  await events.getByLabel(copy.events.startsOn).fill("2026-11-08");
  await events.getByLabel(copy.events.endsOn).fill("2026-11-12");
  await events.getByLabel(copy.events.percent).fill("25");
  const request = posted(page, "/api/demand-events");
  await events.getByRole("button", { name: copy.events.save }).click();
  expect((await request).postDataJSON()).toEqual({
    name: "Diwali",
    city: null,
    starts_on: "2026-11-08",
    ends_on: "2026-11-12",
    uplift_percent: 25,
  });
  await expect(events.getByRole("status")).toHaveText(copy.events.added);
  expect(await axeViolations(page)).toEqual([]);
});

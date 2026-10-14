// Spend, under Growth (docs/decisions/0150-spend.md), which no board draws: a month's offline spend added, and one taken
// off. Every name and figure is made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { UNCONFIRMED } from "../../apps/ops/src/content/common.ts";
import { spend as copy } from "../../apps/ops/src/content/spend.ts";
import { pressTwice } from "./twice.ts";

type List = OpsReply<"/api/spend">;
type Entry = List["entries"][number];

const FLYERS: Entry = {
  id: "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  month: "2026-08",
  city: "Gurgaon",
  channel: "partner",
  campaign: "gurgaon-salons",
  amount: 2500000,
  note: "Salon flyers",
  entered_by: "growth@maneman.test",
  entered_at: "2026-09-01T05:00:00.000Z",
};

const LIST: List = {
  entries: [FLYERS],
  cities: ["Gurgaon", "Bengaluru"],
  channels: ["partner", "referral", "organic_social", "organic_search", "direct"],
  first_month: "2025-10",
  this_month: "2026-09",
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await page.clock.setFixedTime(new Date("2026-09-21T06:30:00.000Z"));
  await answer(page, { "GET /api/spend": json(LIST), ...extra });
  await page.goto("/spend");
  await expect(page.getByRole("heading", { level: 1, name: "Spend" })).toBeVisible();
}

test("adds a month's offline spend for a city, in whole rupees", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/spend": (route: Route) => {
      sent = route.request().postDataJSON();
      return json({ ...FLYERS, id: "6d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a", month: "2026-09", note: null })(route);
    },
  });
  await expect(page.getByRole("cell", { name: "Rs. 25,000", exact: true })).toBeVisible();

  await page.getByLabel(copy.city).selectOption("Bengaluru");
  await page.getByLabel(copy.channel).selectOption("organic_social");
  await page.getByRole("textbox", { name: copy.amount }).fill("12000");
  await page.getByRole("button", { name: copy.add }).click();

  await expect
    .poll(() => sent)
    .toEqual({ month: "2026-09", city: "Bengaluru", channel: "organic_social", amount: 1200000 });
  await expect(page.getByRole("row")).toHaveCount(3);
});

test("takes an entry off the figures", async ({ page }) => {
  await open(page, { "POST /api/spend/{id}/remove": json({ ok: true }) });
  await page.getByRole("button", { name: copy.removeLabel("August 2026", "Gurgaon", "Rs. 25,000") }).click();
  await expect(page.getByText(copy.none)).toBeVisible();
});

const ADDED = { ...FLYERS, id: "6d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a", month: "2026-09", note: null };

async function fillEntry(page: Page) {
  await page.getByLabel(copy.city).selectOption("Bengaluru");
  await page.getByLabel(copy.channel).selectOption("organic_social");
  await page.getByRole("textbox", { name: copy.amount }).fill("12000");
}

test("adds an entry once, however fast Add is pressed twice", async ({ page }) => {
  let sent = 0;
  await open(page, {
    "POST /api/spend": (route: Route) => {
      sent += 1;
      return json(ADDED)(route);
    },
  });
  await fillEntry(page);
  await pressTwice(page.getByRole("button", { name: copy.add }));
  await expect(page.getByRole("row")).toHaveCount(3);
  expect(sent).toBe(1);
});

// A write whose answer never came may have been done: the console says so, and the next press goes with the same key,
// which the API answers as it did rather than adding the entry twice.
test("says an entry whose answer never came may have gone, and sends it again under the same key", async ({ page }) => {
  const keys: string[] = [];
  await open(page, {
    "POST /api/spend": (route: Route) => {
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      return keys.length === 1 ? route.abort("timedout") : json(ADDED)(route);
    },
  });
  await fillEntry(page);
  await page.getByRole("button", { name: copy.add }).click();
  await expect(page.getByText(UNCONFIRMED)).toBeVisible();

  await page.getByRole("button", { name: copy.add }).click();
  await expect(page.getByRole("row")).toHaveCount(3);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

// Spend, under Growth (docs/decisions/0150-spend.md, amended by 0288), which no board draws: a day's spend added, one
// taken off, and an ad account's CSV brought in. Every name and figure is made up.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { UNCONFIRMED } from "../../apps/ops/src/content/common.ts";
import { spend as copy } from "../../apps/ops/src/content/spend.ts";
import { fullDate } from "../../packages/web-kit/dates.ts";
import { pressTwice } from "./twice.ts";

type List = OpsReply<"/api/spend">;
type Entry = List["entries"][number];

const FLYERS: Entry = {
  id: "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
  month: "2026-08",
  spent_date: "2026-08-14",
  city: "Gurgaon",
  channel: "partner",
  campaign: "gurgaon-salons",
  amount: 2500000,
  note: "Salon flyers",
  source: "manual",
  link_id: null,
  cost_line: null,
  entered_by: "growth@maneman.test",
  entered_at: "2026-09-01T05:00:00.000Z",
};

const LIST: List = {
  entries: [FLYERS],
  cities: ["Gurgaon", "Bengaluru"],
  channels: ["google_ads", "meta_ads", "partner", "referral", "organic_social", "organic_search", "direct"],
  first_day: "2025-09-01",
  today: "2026-09-21",
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await page.clock.setFixedTime(new Date("2026-09-21T06:30:00.000Z"));
  await answer(page, { "GET /api/spend": json(LIST), ...extra });
  await page.goto("/spend");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

/** Opens the form from the page's head and fills in an entry: Rs. 12,000 of organic social in Bengaluru. */
async function fillEntry(page: Page) {
  await page.getByRole("button", { name: copy.addOne }).click();
  const form = page.getByRole("dialog", { name: copy.addOne });
  await form.getByLabel(copy.city).selectOption("Bengaluru");
  await form.getByLabel(copy.channel).selectOption("organic_social");
  await form.getByRole("textbox", { name: copy.amount }).fill("12000");
  return form;
}

test("adds a day’s spend for a city, today unless another day is chosen, in whole rupees", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/spend": (route: Route) => {
      sent = route.request().postDataJSON();
      return json({
        ...FLYERS,
        id: "6d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
        month: "2026-09",
        spent_date: "2026-09-21",
        note: null,
      })(route);
    },
  });
  await expect(page.getByRole("cell", { name: "Rs. 25,000", exact: true })).toBeVisible();

  const form = await fillEntry(page);
  await form.getByRole("button", { name: copy.add }).click();

  await expect
    .poll(() => sent)
    .toEqual({ day: "2026-09-21", city: "Bengaluru", channel: "organic_social", amount: 1200000 });
  await expect(page.getByRole("row")).toHaveCount(3);
});

test("takes an entry off the figures", async ({ page }) => {
  await open(page, { "POST /api/spend/{id}/remove": json({ ok: true }) });
  await page.getByRole("button", { name: copy.removeLabel(fullDate("2026-08-14"), "Gurgaon", "Rs. 25,000") }).click();
  await expect(page.getByText(copy.none)).toBeVisible();
});

const ADDED = {
  ...FLYERS,
  id: "6d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
  month: "2026-09",
  spent_date: "2026-09-21",
  note: null,
};

test("adds an entry once, however fast Add is pressed twice", async ({ page }) => {
  let sent = 0;
  await open(page, {
    "POST /api/spend": (route: Route) => {
      sent += 1;
      return json(ADDED)(route);
    },
  });
  const form = await fillEntry(page);
  await pressTwice(form.getByRole("button", { name: copy.add }));
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
  const form = await fillEntry(page);
  await form.getByRole("button", { name: copy.add }).click();
  await expect(form.getByText(UNCONFIRMED)).toBeVisible();

  await form.getByRole("button", { name: copy.add }).click();
  await expect(page.getByRole("row")).toHaveCount(3);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("brings in a Google Ads report by the day, read in the browser, its total shown before it goes", async ({
  page,
}) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/spend/import": (route: Route) => {
      sent = route.request().postDataJSON();
      return json({ added: 2 })(route);
    },
  });
  await page.getByRole("button", { name: copy.importOne }).click();
  const form = page.getByRole("dialog", { name: copy.importOne });
  await form.getByLabel(copy.import.file).setInputFiles({
    name: "campaigns.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Campaign report",
        "Day,Campaign,Cost",
        "2026-09-19,gurgaon-search,1250.00",
        "2026-09-20,national-brand,300.00",
      ].join("\n"),
    ),
  });
  await expect(form.getByText(copy.import.read(2, "Rs. 1,550"))).toBeVisible();
  await form.getByRole("button", { name: copy.import.submit }).click();

  await expect
    .poll(() => sent)
    .toEqual({
      platform: "google",
      rows: [
        { day: "2026-09-19", campaign: "gurgaon-search", amount: 125000 },
        { day: "2026-09-20", campaign: "national-brand", amount: 30000 },
      ],
    });
  await expect(form).toBeHidden();
});

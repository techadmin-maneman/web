// Partners in Settings (docs/decisions/0123-partner-referral-channels.md), which no board draws. Every name and
// figure is made up.

import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { HELD, REFERRERS, TASKS_READ_ON } from "./fixtures.ts";
import { partners as copy } from "../../apps/ops/src/content/partners.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

const SALON = "7b0c8e3a-4d5f-4a6b-8c7d-2e3f4a5b6c7d";

const PARTNERS: OpsReply<"/api/referral-channels"> = {
  channels: [
    {
      id: SALON,
      name: "Looks Salon, Sector 29",
      code: "LSK7P2QX",
      friend_visits: 2,
      valid_days: 180,
      commission: 150000,
      paused_at: null,
      opens: 41,
      referred: 6,
      fitted: 2,
      earned: 300000,
      owed: 150000,
      discount_code: null,
    },
  ],
  limits: { max_visits: 12, min_days: 30, max_days: 1095, max_commission: 5000000 },
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/referrals/held": json(HELD),
    "GET /api/referrers": json(REFERRERS),
    "GET /api/referral-channels": json(PARTNERS),
    ...extra,
  });
  await page.goto("/settings/partners");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const NAME = "Looks Salon, Sector 29";

const row = (page: Page) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: copy.open(NAME) }) });

async function recordOf(page: Page) {
  await page.getByRole("button", { name: copy.open(NAME) }).click();
  return page.getByRole("dialog", { name: NAME });
}

/** The terms as they stand, with the one changed. */
const TERMS = { name: NAME, friend_visits: 2, valid_days: 180, commission: 150000, discount_code: null };

test("lists each partner with its link, what its friend gets, its commission and what came through it", async ({
  page,
}) => {
  await open(page);
  await expect(row(page).getByRole("cell")).toHaveText([
    "127.0.0.1:4321/r/LSK7P2QX",
    "2 visits · 180 days",
    "Rs. 1,500",
    "41",
    "6",
    "2",
    "Rs. 3,000",
    "Rs. 1,500",
  ]);
});

test("adds a partner in rupees", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/referral-channels": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  await page.getByRole("button", { name: copy.add }).click();
  const add = page.getByRole("dialog", { name: copy.form.addTitle });
  await add.getByRole("textbox", { name: copy.form.name, exact: true }).fill("Northside Gym");
  await add.getByLabel(copy.form.friendVisits).fill("1");
  await add.getByLabel(copy.form.validDays).fill("90");
  await add.getByLabel(copy.form.commission).fill("1000");
  await add.getByRole("button", { name: copy.form.add, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(copy.added);
  expect(sent).toEqual({
    name: "Northside Gym",
    friend_visits: 1,
    valid_days: 90,
    commission: 100000,
    discount_code: null,
  });
});

test("changes a partner’s commission where it reads, the other terms sent as they stand", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "PATCH /api/referral-channels/{id}": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  const record = await recordOf(page);
  await record.getByRole("button", { name: `${EDITING.change} ${copy.rows.commission}` }).click();
  const commission = record.getByRole("textbox", { name: copy.rows.commission });
  await expect(commission).toHaveValue("1500");
  await commission.fill("2000");
  await commission.press("Enter");
  await expect(record.getByRole("status")).toHaveText(EDITING.saved);
  expect(sent).toEqual({ ...TERMS, commission: 200000 });
});

test("pauses a partner once it is confirmed", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/referral-channels/{id}/pause": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  const record = await recordOf(page);
  await record.getByRole("button", { name: copy.pausing.label(NAME) }).click();
  await expect(record.getByText(copy.pausing.warning(NAME))).toBeVisible();
  await record.getByRole("button", { name: copy.pausing.confirm, exact: true }).click();
  await expect.poll(() => sent).toEqual({ paused: true });
});

test("downloads a partner’s link as a QR code to print", async ({ page }) => {
  await open(page);
  const record = await recordOf(page);
  const saved = page.waitForEvent("download");
  await record.getByRole("button", { name: copy.qrLabel(NAME) }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("maneman-LSK7P2QX.svg");
  expect(readFileSync(await download.path(), "utf8")).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test("gives a partner’s friends a discount code, written in capitals", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "PATCH /api/referral-channels/{id}": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  const record = await recordOf(page);
  await record.getByRole("button", { name: `${EDITING.change} ${copy.rows.discountCode}` }).click();
  const code = record.getByRole("textbox", { name: copy.rows.discountCode });
  await code.fill("salon2k");
  await code.press("Enter");
  await expect.poll(() => sent).toEqual({ ...TERMS, discount_code: "SALON2K" });
});

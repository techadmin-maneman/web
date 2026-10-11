// Partners on Referrals (docs/decisions/0123-partner-referral-channels.md), which no board draws. Every name and
// figure is made up.

import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { HELD, REFERRERS, TASKS_READ_ON } from "./fixtures.ts";
import { partners as copy } from "../../apps/ops/src/content/partners.ts";

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
  await page.goto("/referrals");
  await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
}

const row = (page: Page) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Looks Salon, Sector 29" }) });

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
    "QR codeEditPause",
  ]);
});

test("adds a partner in rupees once it is reviewed", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/referral-channels": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  await page.getByRole("button", { name: copy.add }).click();
  await page.getByRole("textbox", { name: copy.form.name, exact: true }).fill("Northside Gym");
  await page.getByLabel(copy.form.friendVisits).fill("1");
  await page.getByLabel(copy.form.validDays).fill("90");
  await page.getByLabel(copy.form.commission).fill("1000");
  await page.getByRole("button", { name: copy.form.next }).click();
  await expect(page.getByText(copy.check.friendNew("1 visit · 90 days"))).toBeVisible();
  await expect(page.getByText(copy.check.commissionNew("Rs. 1,000"))).toBeVisible();
  expect(sent).toBeNull();
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.added);
  expect(sent).toEqual({ name: "Northside Gym", friend_visits: 1, valid_days: 90, commission: 100000 });
});

test("changes a partner's commission, and shows only what changes", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "PATCH /api/referral-channels/{id}": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  await row(page)
    .getByRole("button", { name: copy.editLabel("Looks Salon, Sector 29") })
    .click();
  await page.getByLabel(copy.form.commission).fill("2000");
  await page.getByRole("button", { name: copy.form.next }).click();
  await expect(page.getByText(copy.check.commission("Rs. 1,500", "Rs. 2,000"))).toBeVisible();
  await expect(page.getByText(/^Friend gets: /)).toHaveCount(0);
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.saved);
  expect(sent).toEqual({ name: "Looks Salon, Sector 29", friend_visits: 2, valid_days: 180, commission: 200000 });
});

test("pauses a partner once it is confirmed", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/referral-channels/{id}/pause": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PARTNERS)(route);
    },
  });
  await row(page)
    .getByRole("button", { name: copy.pauseLabel("Looks Salon, Sector 29") })
    .click();
  await expect(page.getByText(copy.check.pauseLine)).toBeVisible();
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.paused);
  expect(sent).toEqual({ paused: true });
});

test("downloads a partner's link as a QR code to print", async ({ page }) => {
  await open(page);
  const saved = page.waitForEvent("download");
  await row(page)
    .getByRole("button", { name: copy.qrLabel("Looks Salon, Sector 29") })
    .click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("maneman-LSK7P2QX.svg");
  expect(readFileSync(await download.path(), "utf8")).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

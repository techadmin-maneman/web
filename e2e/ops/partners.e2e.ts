// Partners on Referrals (docs/decisions/0123-partner-referral-channels.md), which no board draws. Every name and
// figure is made up.

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
    "EditPause",
  ]);
});

test("adds a partner in rupees, and pauses one", async ({ page }) => {
  const sent: unknown[] = [];
  const keep = (route: Route) => {
    sent.push(route.request().postDataJSON());
    return json(PARTNERS)(route);
  };
  await open(page, { "POST /api/referral-channels": keep, "POST /api/referral-channels/{id}/pause": keep });
  const form = page.getByRole("form", { name: copy.add });
  await form.getByLabel(copy.form.name).fill("Northside Gym");
  await form.getByLabel(copy.form.friendVisits).fill("1");
  await form.getByLabel(copy.form.validDays).fill("90");
  await form.getByLabel(copy.form.commission).fill("1000");
  await form.getByRole("button", { name: copy.add }).click();
  await row(page)
    .getByRole("button", { name: copy.pauseLabel("Looks Salon, Sector 29") })
    .click();
  await expect
    .poll(() => sent)
    .toEqual([{ name: "Northside Gym", friend_visits: 1, valid_days: 90, commission: 100000 }, { paused: true }]);
});

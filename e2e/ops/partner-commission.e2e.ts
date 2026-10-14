// Partner commission, under Finance (docs/decisions/0124-partner-statements.md), which no board draws. Every name and
// figure is made up.

import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { deleting } from "../../apps/ops/src/content/common.ts";
import { partnerCommission as copy } from "../../apps/ops/src/content/partner-commission.ts";

const SALON = "7b0c8e3a-4d5f-4a6b-8c7d-2e3f4a5b6c7d";

type Book = OpsReply<"/api/partner-statements">;

const AUGUST: Book = {
  month: "2026-08",
  today: "2026-09-21",
  this_month: "2026-09",
  first_month: "2026-07",
  max_amount: 100000000,
  statements: [
    {
      channel_id: SALON,
      name: "Looks Salon, Sector 29",
      code: "LSK7P2QX",
      fitted: 2,
      earned: 250000,
      taken_back: 1,
      taken_back_amount: 150000,
      due: 100000,
      payout: null,
      owed: 250000,
      lines: [
        { day: "2026-08-01", kind: "fitted", commission: 150000 },
        { day: "2026-08-15", kind: "fitted", commission: 100000 },
        { day: "2026-08-20", kind: "taken_back", commission: 150000 },
      ],
    },
  ],
};

const PAID: Book = {
  ...AUGUST,
  statements: AUGUST.statements.map((each) => ({
    ...each,
    payout: { amount: 100000, paid_on: "2026-09-05", reference: "UTR0905", recorded_by: "finance@maneman.test" },
    owed: 150000,
  })),
};

async function open(page: Page, extra: Parameters<typeof answer>[1] = {}) {
  await page.clock.setFixedTime(new Date("2026-09-21T06:30:00.000Z"));
  await answer(page, { "GET /api/partner-statements": json(AUGUST), ...extra });
  await page.goto("/partner-commission");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const row = (page: Page) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Looks Salon, Sector 29" }) });

test("shows last month’s fits, what refunds took back, what is due and what is owed", async ({ page }) => {
  await open(page);
  await expect(page.getByLabel(copy.month)).toHaveValue("2026-08");
  await expect(row(page).getByRole("cell")).toHaveText([
    "2",
    "Rs. 2,500",
    "Rs. 1,500",
    "Rs. 1,000",
    "—",
    "Rs. 2,500",
    `${copy.statement}${copy.record}`,
  ]);
});

test("records the month’s payment once it is reviewed", async ({ page }) => {
  let sent: unknown = null;
  await open(page, {
    "POST /api/partner-statements/{id}/payouts": (route: Route) => {
      sent = route.request().postDataJSON();
      return json(PAID)(route);
    },
  });
  await row(page)
    .getByRole("button", { name: copy.recordLabel("Looks Salon, Sector 29") })
    .click();
  await expect(page.getByLabel(copy.form.amount)).toHaveValue("1000");
  await page.getByLabel(copy.form.paidOn).fill("2026-09-05");
  await page.getByRole("textbox", { name: copy.form.reference }).fill("UTR0905");
  await page.getByRole("button", { name: copy.form.next }).click();
  await expect(page.getByText(copy.check.line("Rs. 1,000", "Sat 5 Sep", "UTR0905"))).toBeVisible();
  expect(sent).toBeNull();
  await page.getByRole("button", { name: copy.check.send }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.recorded);
  expect(sent).toEqual({ month: "2026-08", amount: 100000, paid_on: "2026-09-05", reference: "UTR0905" });
  await expect(row(page).getByRole("cell").nth(4)).toHaveText("Rs. 1,000 · Sat 5 SepUTR0905");
});

test("deletes a payment recorded by mistake", async ({ page }) => {
  await open(page, {
    "GET /api/partner-statements": json(PAID),
    "POST /api/partner-statements/{id}/payouts/{month}/delete": json(AUGUST),
  });
  await row(page)
    .getByRole("button", { name: copy.deletePaymentLabel("Looks Salon, Sector 29") })
    .click();
  await page.getByRole("button", { name: deleting.confirm }).click();
  await expect(page.getByRole("status")).toHaveText(copy.done.deleted);
});

test("downloads a partner’s statement, with days and amounts and no client", async ({ page }) => {
  await open(page);
  const saved = page.waitForEvent("download");
  await row(page)
    .getByRole("button", { name: copy.statementLabel("Looks Salon, Sector 29") })
    .click();
  const download = await saved;
  expect(download.suggestedFilename()).toBe("statement-LSK7P2QX-2026-08.csv");
  const text = readFileSync(await download.path(), "utf8");
  expect(text).toContain("2026-08-20,Taken back: first fit refunded,-1500.00");
  expect(text).toContain(",Due for the month,1000.00");
});

test("reads another month when one is chosen", async ({ page }) => {
  const asked: string[] = [];
  await open(page, {
    "GET /api/partner-statements": (route: Route) => {
      asked.push(new URL(route.request().url()).searchParams.get("month") ?? "");
      return json(AUGUST)(route);
    },
  });
  await page.getByLabel(copy.month).selectOption({ label: "July 2026" });
  await expect.poll(() => asked).toEqual(["", "2026-07"]);
});

// Operations · Supply plan (docs/decisions/0180-supply-plan.md): the latest draft's transfers and orders, each with the
// figures behind it, one approved at a changed quantity and one rejected with why.

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

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/supply-plan": json(PLAN), ...extra });
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
  await expect(row).toContainText(copy.states.approved ?? "");
  expect(await axeViolations(page)).toEqual([]);
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

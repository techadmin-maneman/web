// Operations · Purchasing (docs/decisions/0166-purchase-orders.md): orders listed with their state and total, each
// opened to approve, mark sent, cancel with why, or print; and a new order drafted from a supplier's list.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { purchasing as copy } from "../../apps/ops/src/content/purchasing.ts";

const ORDER = {
  id: "po-1",
  number: 7,
  supplier_id: "sup-1",
  currency: "INR",
  state: "drafted",
  expected_on: "2026-10-15",
  note: null,
  total: 216_000,
  lines: [{ id: "pl-1", consumable_code: "solvent", quantity: 48, unit_price: 4500, received: 0 }],
  drafted_by: "ops@maneman.in",
  drafted_at: "2026-09-21T06:30:00.000Z",
  approved_by: null,
  second_approved_by: null,
  sent_at: null,
  cancel_reason: null,
  needs_second_approval: true,
} as const;

const BOOK = {
  orders: [ORDER],
  suppliers: [
    {
      id: "sup-1",
      name: "Kesh Supplies",
      currency: "INR",
      items: [{ consumable_code: "solvent", unit_price: 4500, pack_size: 12, minimum_order: 24, lead_time_days: 7 }],
    },
  ],
  consumables: [{ code: "solvent", name: "Solvent", unit: "ml" }],
  second_approval_above_rupees: 0,
} satisfies OpsReply<"/api/purchase-orders">;

const FIRST_APPROVED = { ...BOOK, orders: [{ ...ORDER, approved_by: "ops@maneman.in" }] };

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/purchase-orders": json(BOOK), ...extra });
  await page.goto("/purchasing");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test("lists each order, opens one, and approves it, awaiting a second approver", async ({ page }) => {
  await open(page, { "POST /api/purchase-orders/{id}/approve": json(FIRST_APPROVED) });
  const row = page.getByRole("row").filter({ hasText: "PO-0007" });
  await expect(row).toContainText("Kesh Supplies");
  await expect(row).toContainText(copy.states.drafted ?? "");
  await expect(row).toContainText("Rs. 2,160");
  await page.getByRole("button", { name: copy.open("PO-0007") }).click();

  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  await expect(panel.getByRole("row").filter({ hasText: "Solvent" })).toContainText("Rs. 45");
  const approved = posted(page, "/api/purchase-orders/po-1/approve");
  await panel.getByRole("button", { name: copy.order.approve }).click();
  await approved;
  await expect(panel).toContainText(copy.awaitingSecond);
  await expect(panel.getByRole("button", { name: copy.order.secondApprove })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("cancels an order, with why", async ({ page }) => {
  const cancelled = { ...BOOK, orders: [{ ...ORDER, state: "cancelled", cancel_reason: "Out of stock" }] };
  await open(page, { "POST /api/purchase-orders/{id}/cancel": json(cancelled) });
  await page.getByRole("button", { name: copy.open("PO-0007") }).click();
  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  await panel.getByRole("button", { name: copy.order.cancel }).click();
  await panel.getByLabel(copy.order.reason).fill("Out of stock");
  const sent = posted(page, "/api/purchase-orders/po-1/cancel");
  await panel.getByRole("button", { name: copy.order.confirmCancel }).click();
  expect((await sent).postDataJSON()).toEqual({ reason: "Out of stock" });
  await expect(panel).toContainText(copy.order.cancelledWhy("Out of stock"));
});

test("drafts an order from a supplier's list, its total shown first", async ({ page }) => {
  await open(page, { "POST /api/purchase-orders": json(BOOK) });
  const draft = page.getByRole("region", { name: copy.draft.title });
  await expect(draft.getByLabel(copy.draft.quantity)).toHaveValue("24");
  await draft.getByLabel(copy.draft.quantity).fill("36");
  await expect(draft).toContainText(copy.draft.total("Rs. 1,620"));
  await draft.getByLabel(copy.draft.expected).fill("2026-10-20");
  const sent = posted(page, "/api/purchase-orders");
  await draft.getByRole("button", { name: copy.draft.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    supplier_id: "sup-1",
    lines: [{ consumable_code: "solvent", quantity: 36 }],
    expected_on: "2026-10-20",
    note: null,
  });
  expect(await axeViolations(page)).toEqual([]);
});

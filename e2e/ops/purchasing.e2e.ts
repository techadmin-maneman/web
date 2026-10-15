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
  state: "drafted" as const,
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
  receipts: [],
};

const BOOK = {
  orders: [ORDER],
  suppliers: [
    {
      id: "sup-1",
      name: "Kesh Supplies",
      currency: "INR",
      payment_terms_days: 30,
      items: [
        {
          consumable_code: "solvent",
          their_code: "KS-SOL-500",
          unit_price: 4500,
          pack_size: 12,
          minimum_order: 24,
          lead_time_days: 7,
        },
      ],
    },
  ],
  consumables: [{ code: "solvent", name: "Solvent", unit: "ml", unit_cost: 4000 }],
  second_approval_above_rupees: 0,
  letterhead: null,
} satisfies OpsReply<"/api/purchase-orders">;

const LETTERHEAD = {
  legal_name: "Mane Man Grooming Services Private Limited",
  registered_office: "Plot 12, Okhla Phase II\nNew Delhi 110020",
  cin: "U74999DL2026PTC123456",
  gstin: "06AABCM1234A1Z5",
  deliver_to: "Warehouse 4, Sector 37\nGurgaon 122001",
};

const FIRST_APPROVED = { ...BOOK, orders: [{ ...ORDER, approved_by: "ops@maneman.in" }] };

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, {
    "GET /api/purchase-orders": json(BOOK),
    "GET /api/supplier-claims": json({ claims: [], returns: [] }),
    "GET /api/supplier-scorecard": json({ suppliers: [] }),
    ...extra,
  });
  await page.goto("/purchasing");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test("lists each order, opens one, and approves it, awaiting a second approver", async ({ page }) => {
  await open(page, { "POST /api/purchase-orders/{id}/approve": json(FIRST_APPROVED) });
  const row = page.getByRole("row").filter({ hasText: "PO-0007" });
  await expect(row).toContainText("Kesh Supplies");
  await expect(row).toContainText(copy.states.drafted);
  await expect(row).toContainText("Rs. 2,160");
  const opener = page.getByRole("button", { name: copy.open("PO-0007") });
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.click();

  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  // The press says what it opened, and the keyboard goes there.
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(panel.getByRole("row").filter({ hasText: "Solvent" })).toContainText("Rs. 45");
  const approved = posted(page, "/api/purchase-orders/po-1/approve");
  await panel.getByRole("button", { name: copy.order.approve }).click();
  await approved;
  await expect(panel).toContainText(copy.awaitingSecond);
  await expect(panel.getByRole("button", { name: copy.order.secondApprove })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await opener.click();
  await expect(panel).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
});

test("does not offer the second approval to the manager who gave the first", async ({ page }) => {
  await open(page, {
    "GET /api/purchase-orders": json(FIRST_APPROVED),
    "GET /api/whoami": json({
      signed_in_as: "ops@maneman.in",
      sign_out: null,
      staff: {
        enforced: false,
        listed: true,
        grants: [],
        may_call: ["GET /api/purchase-orders", "POST /api/purchase-orders/{id}/approve"],
      },
    }),
  });
  await page.getByRole("button", { name: copy.open("PO-0007") }).click();
  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  await expect(panel).toContainText(copy.awaitingSecond);
  await expect(panel.getByRole("button", { name: copy.order.secondApprove })).toHaveCount(0);
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

test("drafts an order from a supplier’s list, its total shown first", async ({ page }) => {
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

test("questions a price far above what Settings say an item costs, and clears the form once drafted", async ({
  page,
}) => {
  const cheap = { ...BOOK, consumables: [{ code: "solvent", name: "Solvent", unit: "ml", unit_cost: 450 }] };
  await open(page, { "GET /api/purchase-orders": json(cheap), "POST /api/purchase-orders": json(cheap) });
  const draft = page.getByRole("region", { name: copy.draft.title });
  await expect(draft).toContainText(copy.draft.farAbove("Rs. 45", "ml", 10, "Rs. 4.50"));
  await draft.getByLabel(copy.draft.quantity).fill("36");
  await draft.getByLabel(copy.draft.note).fill("Rush");
  await draft.getByRole("button", { name: copy.draft.send }).click();
  await expect(draft.getByLabel(copy.draft.quantity)).toHaveValue("24");
  await expect(draft.getByLabel(copy.draft.note)).toHaveValue("");
});

test("receives what arrived of a sent order, and lists the receipt with its landed cost", async ({ page }) => {
  const sent = {
    ...BOOK,
    orders: [{ ...ORDER, state: "sent" as const, approved_by: "a@maneman.in", second_approved_by: "b@maneman.in" }],
  };
  const receivedLine = {
    po_line_id: "pl-1",
    received: 24,
    damaged: 2,
    qc_failed: 0,
    lot_code: "SV-7",
    expires_on: null,
    landed_unit_paise: 5500,
  };
  const received = {
    ...BOOK,
    orders: [
      {
        ...ORDER,
        state: "part_received" as const,
        receipts: [
          {
            id: "rc-1",
            received_by: "ops@maneman.in",
            received_at: "2026-09-21T06:30:00.000Z",
            supplier_invoice: "INV-88",
            lines: [receivedLine],
          },
        ],
      },
    ],
  };
  await open(page, {
    "GET /api/purchase-orders": json(sent),
    "POST /api/purchase-orders/{id}/receipts": json(received),
  });
  await page.getByRole("button", { name: copy.open("PO-0007") }).click();
  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  await panel.getByRole("button", { name: copy.receive.open }).click();
  const form = panel.getByRole("group", { name: copy.receive.title });
  await form.getByLabel(copy.receive.received).fill("24");
  await form.getByLabel(copy.receive.damaged).fill("2");
  await form.getByLabel(copy.receive.lot).fill("SV-7");
  await form.getByLabel(copy.receive.invoice).fill("INV-88");
  await form.getByLabel(copy.receive.freight).fill("240");
  const posted_ = posted(page, "/api/purchase-orders/po-1/receipts");
  await form.getByRole("button", { name: copy.receive.send }).click();
  expect((await posted_).postDataJSON()).toEqual({
    lines: [{ po_line_id: "pl-1", received: 24, damaged: 2, qc_failed: 0, lot_code: "SV-7", expires_on: null }],
    supplier_invoice: "INV-88",
    rate_micro_rupees: null,
    freight_paise: 24_000,
    duty_paise: 0,
    clearing_paise: 0,
    note: null,
  });
  await expect(panel).toContainText(
    copy.receipts.item({ name: "Solvent", received: 24, damaged: 2, failed: 0, landed: "Rs. 55" }),
  );
  expect(await axeViolations(page)).toEqual([]);
});

// The printed order gave no company, no GSTIN, no delivery address, none of the supplier's own codes, and no unit.
test("a manager sets the letterhead, and a printed order carries it with what the supplier needs", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  const set = { ...BOOK, letterhead: LETTERHEAD, orders: [{ ...ORDER, approved_by: "ops@maneman.in" }] };
  await open(page, { "POST /api/purchase-orders/letterhead": json(set) });
  const letterhead = page.getByRole("region", { name: copy.letterhead.title });
  await expect(letterhead).toContainText(copy.letterhead.missing);
  await letterhead.getByLabel(copy.letterhead.legalName).fill(LETTERHEAD.legal_name);
  await letterhead.getByLabel(copy.letterhead.registeredOffice).fill(LETTERHEAD.registered_office);
  await letterhead.getByLabel(copy.letterhead.cin).fill("u74999dl2026ptc123456");
  await letterhead.getByLabel(copy.letterhead.gstin).fill("06aabcm1234a1z5");
  await letterhead.getByLabel(copy.letterhead.deliverTo).fill(LETTERHEAD.deliver_to);
  const sent = posted(page, "/api/purchase-orders/letterhead");
  await letterhead.getByRole("button", { name: copy.letterhead.save }).click();
  expect((await sent).postDataJSON()).toEqual(LETTERHEAD);

  await page.getByRole("button", { name: copy.open("PO-0007") }).click();
  await page
    .getByRole("region", { name: "PO-0007 · Kesh Supplies" })
    .getByRole("button", { name: copy.order.print })
    .click();
  const sheet = page.locator("#order-sheet");
  await expect(sheet).toContainText(
    `${copy.sheet.from}: ${LETTERHEAD.legal_name} · CIN U74999DL2026PTC123456 · GSTIN 06AABCM1234A1Z5`,
  );
  await expect(sheet).toContainText(`${copy.sheet.registeredOffice}: Plot 12, Okhla Phase II`);
  await expect(sheet).toContainText("Warehouse 4, Sector 37");
  await expect(sheet).toContainText("KS-SOL-500");
  await expect(sheet).toContainText("48 ml (4 packs of 12)");
  await expect(sheet).toContainText("Payment: 30 days");
  await expect(sheet).toContainText("Approved by ops@maneman.in");
  await expect(sheet).toContainText("Date: 21 Sep 2026");
});

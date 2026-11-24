// Operations · Purchasing (docs/decisions/0166-purchase-orders.md): orders listed with their state and total, each
// opened to approve, mark sent, cancel with why, or print; and a new order drafted from a supplier's list.

import type { Page } from "@playwright/test";
import { DISMISS } from "../../packages/ui/words.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, TASKS, TASKS_READ_ON, type Answers, type OpsReply } from "./fixtures.ts";
import { expectOneBoxALine } from "./one-box-a-line.ts";
import { purchasing as copy } from "../../apps/ops/src/content/purchasing.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

const ORDER = {
  id: "po-1",
  number: 7,
  supplier_id: "sup-1",
  currency: "INR",
  state: "drafted" as const,
  expected_on: "2026-10-15",
  note: null,
  total: 216_000,
  lines: [{ id: "pl-1", consumable_code: "solvent", quantity: 48, unit_price: 4500, received: 0, hair_system: false }],
  drafted_by: "ops@maneman.in",
  drafted_at: "2026-09-21T06:30:00.000Z",
  approved_by: null,
  approved_by_name: null,
  second_approved_by: null,
  sent_at: null,
  cancel_reason: null,
  needs_second_approval: true,
  custom_order: null,
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
  receipt_checks: [
    { id: "base_size", name: "Base size" },
    { id: "colour", name: "Colour against the ring" },
    { id: "density", name: "Hair density" },
    { id: "lace_knots", name: "Lace and knots" },
    { id: "label", name: "Label" },
  ],
  letterhead: null,
} satisfies OpsReply<"/api/purchase-orders">;

const LETTERHEAD = {
  legal_name: "Mane Man Private Limited",
  registered_office: "Plot 12, Okhla Phase II\nNew Delhi 110020",
  cin: "U74999DL2026PTC123456",
  gstin: "06AABCM1234A1Z5",
  deliver_to: "Warehouse 4, Sector 37\nGurgaon 122001",
};

const FIRST_APPROVED = {
  ...BOOK,
  orders: [{ ...ORDER, approved_by: "ops@maneman.in", approved_by_name: "ops@maneman.in" }],
};

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

test("says beside its title how many orders await approval, an order sent not among them", async ({ page }) => {
  const sent = { ...ORDER, id: "po-2", number: 8, state: "sent" as const };
  await open(page, { "GET /api/purchase-orders": json({ ...BOOK, orders: [ORDER, sent] }) });
  await expect(page.getByRole("main").getByText(copy.toApprove(1), { exact: true })).toBeVisible();
});

// A custom order's purchase order was drafted with no word of whose it was, and a task could not open it.
test("names the client a custom order's purchase order is for, and opens it from its task", async ({ page }) => {
  const PO = "7b000000-0000-4000-8000-000000000002";
  const toSend = {
    ...TASKS,
    groups: [
      {
        group: "custom_order_to_send",
        count: 1,
        closable: false,
        snoozable: true,
        tasks: [
          {
            id: "7c000000-0000-4000-8000-000000000001",
            person: { id: "22000000-0000-4000-8000-000000000001", name: "Neha Kapoor" },
            facts: {
              group: "custom_order_to_send",
              order: 42,
              purchase_order: 8,
              purchase_order_id: PO,
              approved: false,
            },
            detail: "CU-0042 · PO-0008",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-22T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/tasks">;
  const CUSTOM = {
    ...ORDER,
    id: PO,
    number: 8,
    lines: [{ id: "pl-2", consumable_code: "hs-1", quantity: 1, unit_price: 15000, received: 0, hair_system: true }],
    total: 15_000,
    custom_order: {
      id: "co-1",
      number: 42,
      person_id: "22000000-0000-4000-8000-000000000001",
      person_name: "Neha Kapoor",
    },
  };
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/tasks": json(toSend),
    "GET /api/purchase-orders": json({ ...BOOK, orders: [ORDER, CUSTOM] }),
    "GET /api/supplier-claims": json({ claims: [], returns: [] }),
    "GET /api/supplier-scorecard": json({ suppliers: [] }),
  });
  // The board leads the task to its purchase order, opened there.
  await page.goto("/tasks");
  await page.getByRole("link", { name: "Send in Purchasing · Neha Kapoor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/purchasing#order-${PO}$`));
  await expect(page.getByRole("row").filter({ hasText: "PO-0008" })).toContainText(copy.customFor(42, "Neha Kapoor"));
  const named = page.getByRole("link", { name: copy.customFor(42, "Neha Kapoor") });
  await expect(named).toHaveAttribute("href", "/clients/22000000-0000-4000-8000-000000000001/pieces");
  await expect(page.getByRole("heading", { name: /PO-0008/ })).toBeVisible();
});

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
      cities: [],
      every_city: true,
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
  // Cancelled, nothing is left to cancel or keep.
  await expect(panel.getByRole("button", { name: DISMISS.keep })).toHaveCount(0);
  await expect(panel.getByLabel(copy.order.reason)).toHaveCount(0);
});

/** The form that drafts an order, opened from the page's head. */
async function newOrder(page: Page) {
  await page.getByRole("button", { name: copy.draft.title }).click();
  return page.getByRole("dialog", { name: copy.draft.title });
}

test("drafts an order from a supplier’s list, a box to a line, its total shown first", async ({ page }) => {
  await open(page, { "POST /api/purchase-orders": json(BOOK) });
  const draft = await newOrder(page);
  await expectOneBoxALine(page, copy.draft.title);
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
  const draft = await newOrder(page);
  await expect(draft).toContainText(copy.draft.farAbove("Rs. 45", "ml", 10, "Rs. 4.50"));
  await draft.getByLabel(copy.draft.quantity).fill("36");
  await draft.getByLabel(copy.draft.note).fill("Rush");
  await draft.getByRole("button", { name: copy.draft.send }).click();
  await expect(draft).toBeHidden();
  const again = await newOrder(page);
  await expect(again.getByLabel(copy.draft.quantity)).toHaveValue("24");
  await expect(again.getByLabel(copy.draft.note)).toHaveValue("");
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

// A receipt's quality check was one number: the supplier was told how many failed, never what was wrong.
/** A sent order of three hair systems, its receive form open with two accepted and one failed, as ops check `checks`. */
async function receivingHair(page: Page, checks: readonly string[]) {
  const hairLine = {
    id: "pl-2",
    consumable_code: "hs_essential",
    quantity: 3,
    unit_price: 2_000_000,
    received: 0,
    hair_system: true,
  };
  const sent = {
    ...BOOK,
    consumables: [...BOOK.consumables, { code: "hs_essential", name: "Essential 8x10", unit: "piece", unit_cost: 0 }],
    receipt_checks: BOOK.receipt_checks.filter((check) => checks.includes(check.id)),
    orders: [{ ...ORDER, state: "sent" as const, approved_by: "a@maneman.in", lines: [hairLine] }],
  };
  await open(page, {
    "GET /api/purchase-orders": json(sent),
    "POST /api/purchase-orders/{id}/receipts": json(sent),
  });
  await page.getByRole("button", { name: copy.open("PO-0007") }).click();
  const panel = page.getByRole("region", { name: "PO-0007 · Kesh Supplies" });
  await panel.getByRole("button", { name: copy.receive.open }).click();
  const form = panel.getByRole("group", { name: copy.receive.title });
  await form.getByLabel(copy.receive.received).fill("2");
  await form.getByLabel(copy.receive.failed).fill("1");
  return form;
}

test("asks what a hair system's failed pieces failed, of the checks ops make, and sends it", async ({ page }) => {
  const form = await receivingHair(page, ["colour", "density"]);
  const failed = form.getByRole("group", { name: copy.receive.failedPoints });
  await expect(failed.getByRole("checkbox")).toHaveCount(2);
  const send = form.getByRole("button", { name: copy.receive.send });
  await expect(send).toBeDisabled();

  await failed.getByRole("checkbox", { name: "Hair density" }).check();
  const posted_ = posted(page, "/api/purchase-orders/po-1/receipts");
  await send.click();
  expect((await posted_).postDataJSON()).toMatchObject({
    lines: [{ po_line_id: "pl-2", received: 2, qc_failed: 1, qc_failed_points: ["density"] }],
  });
});

// With every check switched off, the form asked for a point there was none to tick, and held the receipt for good.
test("asks nothing of a hair system's failed pieces while ops check none of the points", async ({ page }) => {
  const form = await receivingHair(page, []);
  await expect(form.getByRole("group", { name: copy.receive.failedPoints })).toHaveCount(0);
  const send = form.getByRole("button", { name: copy.receive.send });
  await expect(send).toBeEnabled();
  const posted_ = posted(page, "/api/purchase-orders/po-1/receipts");
  await send.click();
  const [line] = ((await posted_).postDataJSON() as { lines: Record<string, unknown>[] }).lines;
  expect(line).toMatchObject({ po_line_id: "pl-2", qc_failed: 1 });
  expect(line).not.toHaveProperty("qc_failed_points");
});

// The printed order gave no company, no GSTIN, no delivery address, none of the supplier's own codes, and no unit.
test("a manager sets the letterhead, and a printed order carries it with what the supplier needs", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  const set = {
    ...BOOK,
    letterhead: LETTERHEAD,
    orders: [{ ...ORDER, approved_by: "ops@maneman.in", approved_by_name: "Ops desk" }],
  };
  await open(page, { "POST /api/purchase-orders/letterhead": json(set) });
  // Unset, a line above the orders, and Set it opens its form in a drawer (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md).
  await expect(page.getByText(copy.letterhead.missing)).toBeVisible();
  await page.getByRole("button", { name: copy.letterhead.set }).click();
  const letterhead = page.getByRole("dialog", { name: copy.letterhead.title });
  await letterhead.getByLabel(copy.letterhead.legalName).fill(LETTERHEAD.legal_name);
  await letterhead.getByLabel(copy.letterhead.registeredOffice).fill(LETTERHEAD.registered_office);
  await letterhead.getByLabel(copy.letterhead.cin).fill("u74999dl2026ptc123456");
  await letterhead.getByLabel(copy.letterhead.gstin).fill("06aabcm1234a1z5");
  await letterhead.getByLabel(copy.letterhead.deliverTo).fill(LETTERHEAD.deliver_to);
  const sent = posted(page, "/api/purchase-orders/letterhead");
  await letterhead.getByRole("button", { name: copy.letterhead.save }).click();
  expect((await sent).postDataJSON()).toEqual(LETTERHEAD);
  // Set, it is the page's Letterhead, its lines changed where they read.
  await expect(letterhead).toBeHidden();
  await expect(page.getByRole("button", { name: copy.letterhead.title })).toBeVisible();

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
  await expect(sheet).toContainText("Approved by Ops desk");
  await expect(sheet).toContainText("Date: 21 Sep");
});

test("changes a line of the letterhead where it reads, the rest sent as they stand", async ({ page }) => {
  const set = { ...BOOK, letterhead: LETTERHEAD };
  await open(page, { "GET /api/purchase-orders": json(set), "POST /api/purchase-orders/letterhead": json(set) });
  await page.getByRole("button", { name: copy.letterhead.title }).click();
  const letterhead = page.getByRole("dialog", { name: copy.letterhead.title });
  await letterhead.getByRole("button", { name: `${EDITING.change} ${copy.letterhead.gstin}` }).click();
  const gstin = letterhead.getByRole("textbox", { name: copy.letterhead.gstin });
  await gstin.fill("07aabcm1234a1z5");
  const sent = posted(page, "/api/purchase-orders/letterhead");
  await gstin.press("Enter");
  expect((await sent).postDataJSON()).toEqual({ ...LETTERHEAD, gstin: "07AABCM1234A1Z5" });
});

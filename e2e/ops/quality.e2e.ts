// Operations · Quality (docs/decisions/0187-recalls.md, 0188-failure-rates-and-value-at-risk.md): a lot recalled with
// why, opened to where its stock is and who wears it; and the failure rates and value at risk beside it.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, type OpsReply } from "./fixtures.ts";
import { quality as copy } from "../../apps/ops/src/content/quality.ts";
import { stockPlaces } from "../../apps/ops/src/content/stock-places.ts";

const BOOK = {
  recalls: [],
  lots: [{ id: "lot-1", lot_code: "BAD-0921", consumable_code: "hs-1", name: "Essential 8x10" }],
} satisfies OpsReply<"/api/recalls">;

const DETAIL = {
  id: "rc-1",
  number: 1,
  lot_id: "lot-1",
  lot_code: "BAD-0921",
  consumable_code: "hs-1",
  name: "Essential 8x10",
  unit: "piece",
  reason: "Supplier warned of shedding",
  raised_at: "2026-09-21T06:30:00.000Z",
  closed_at: null,
  held: [{ place_id: "central", place: "Warehouse", quantity: 2 }],
  worn: [
    {
      piece_id: "piece-1",
      piece_code: "MM-ESS-0000001-A",
      person_id: "p-1",
      person: "Rohit Malhotra",
      due_on: "2026-09-21",
    },
  ],
} satisfies OpsReply<"/api/recalls/{id}">;

const GROUP = { name: "Essential 8x10", fitted: 8, failed: 1, rate_percent: 12.5 };
const RATES = {
  since: "2025-09-21",
  by_code: [GROUP],
  by_lot: [{ ...GROUP, name: "Essential 8x10 · BAD-0921" }],
  by_supplier: [],
  by_technician: [{ ...GROUP, name: "Imran Qureshi" }],
  by_reason: [{ ...GROUP, name: "Edges lifting" }],
} satisfies OpsReply<"/api/quality/failures">;

const RISK = {
  total_value: 310000,
  lots: [
    {
      place_id: "central",
      place: "Warehouse",
      consumable_code: "solvent",
      name: "Solvent",
      lot_code: "SOON",
      expires_on: "2026-10-01",
      quantity: 62,
      value: 310000,
      suggestion: "move" as const,
      move_to: "Imran Qureshi",
    },
  ],
} satisfies OpsReply<"/api/stock/expiry-risk">;

test("says why a recall was refused in its drawer, and offers none with no lot to recall", async ({ page }) => {
  await answer(page, {
    "GET /api/recalls": json(BOOK),
    "POST /api/recalls": fails(403, "not_permitted"),
    "GET /api/quality/failures": json(RATES),
    "GET /api/stock/expiry-risk": json(RISK),
  });
  await page.goto("/quality");
  await page.getByRole("button", { name: copy.raise }).click();
  const raising = page.getByRole("dialog", { name: copy.raise });
  await raising.getByLabel(copy.reason).fill("Supplier warned of shedding");
  await raising.getByRole("button", { name: copy.confirmRaise }).click();
  await expect(raising.getByText(copy.errors.not_permitted, { exact: true })).toBeVisible();

  await answer(page, { "GET /api/recalls": json({ ...BOOK, lots: [] }) });
  await page.reload();
  await expect(page.getByRole("region", { name: copy.recalls })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.raise })).toHaveCount(0);
});

test("recalls a lot with why, and shows where it is and who wears it", async ({ page }) => {
  await answer(page, {
    "GET /api/recalls": json(BOOK),
    "POST /api/recalls": json(DETAIL),
    "GET /api/quality/failures": json(RATES),
    "GET /api/stock/expiry-risk": json(RISK),
  });
  await page.goto("/quality");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  const recalls = page.getByRole("region", { name: copy.recalls });
  await expect(recalls).toContainText(copy.none);
  // Started from the page's head, in a drawer (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md).
  await page.getByRole("button", { name: copy.raise }).click();
  const raising = page.getByRole("dialog", { name: copy.raise });
  await raising.getByLabel(copy.reason).fill("Supplier warned of shedding");
  const request = page.waitForRequest((sent) => sent.url().endsWith("/api/recalls") && sent.method() === "POST");
  await raising.getByRole("button", { name: copy.confirmRaise }).click();
  expect((await request).postDataJSON()).toEqual({ lot_id: "lot-1", reason: "Supplier warned of shedding" });
  const detail = page.getByRole("region", {
    name: `${copy.number(1)} · ${copy.lotLabel("Essential 8x10", "BAD-0921")}`,
  });
  await expect(detail).toContainText(stockPlaces.kinds.warehouse);
  await expect(detail).toContainText("Rohit Malhotra");
  await expect(page.getByRole("region", { name: copy.failures })).toContainText(copy.rate(12.5));
  await expect(page.getByRole("region", { name: copy.risk })).toContainText(copy.moveTo("Imran Qureshi"));
  expect(await axeViolations(page)).toEqual([]);
});

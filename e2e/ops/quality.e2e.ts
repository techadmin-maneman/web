// Operations · Quality (docs/decisions/0187-recalls.md): a lot recalled with why, opened to where its stock is and who
// wears it.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./fixtures.ts";
import { quality as copy } from "../../apps/ops/src/content/quality.ts";

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
  reason: "Supplier warned of shedding",
  raised_at: "2026-09-21T06:30:00.000Z",
  closed_at: null,
  held: [{ place_id: "central", place: "Warehouse", quantity: 2 }],
  worn: [{ piece_code: "MM-ESS-0000001-A", person_id: "p-1", person: "Rohit Malhotra", due_on: "2026-09-21" }],
} satisfies OpsReply<"/api/recalls/{id}">;

test("recalls a lot with why, and shows where it is and who wears it", async ({ page }) => {
  await answer(page, { "GET /api/recalls": json(BOOK), "POST /api/recalls": json(DETAIL) });
  await page.goto("/quality");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  const recalls = page.getByRole("region", { name: copy.recalls });
  await expect(recalls).toContainText(copy.none);
  await recalls.getByLabel(copy.reason).fill("Supplier warned of shedding");
  const request = page.waitForRequest((sent) => sent.url().endsWith("/api/recalls") && sent.method() === "POST");
  await recalls.getByRole("button", { name: copy.confirmRaise }).click();
  expect((await request).postDataJSON()).toEqual({ lot_id: "lot-1", reason: "Supplier warned of shedding" });
  const detail = page.getByRole("region", {
    name: `${copy.number(1)} · ${copy.lotLabel("Essential 8x10", "BAD-0921")}`,
  });
  await expect(detail).toContainText("Warehouse");
  await expect(detail).toContainText("Rohit Malhotra");
  expect(await axeViolations(page)).toEqual([]);
});

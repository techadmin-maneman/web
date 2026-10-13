// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from and on what terms, and what each
// supplies, every change checked old beside new before it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";

const copy = settingsCopy.suppliers;

const LUMINA = {
  id: "sup-1",
  name: "Lumina Hair Co",
  gstin: null,
  country: "CN",
  currency: "USD",
  contact_name: "Wei Chen",
  contact_phone: null,
  contact_email: null,
  payment_terms_days: 30,
  warranty_days: 90,
  retired_at: null,
  items: [
    {
      consumable_code: "solvent",
      their_code: "SV-500",
      unit_price: 1250,
      pack_size: 12,
      minimum_order: 24,
      lead_time_days: 21,
    },
  ],
};

const BOOK = {
  suppliers: [LUMINA],
  consumables: [
    { code: "solvent", name: "Solvent", unit: "ml" },
    { code: "tape_strips", name: "Tape strips", unit: "strip" },
  ],
} satisfies OpsReply<"/api/suppliers">;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/suppliers": json(BOOK), ...extra });
  await page.goto("/settings/suppliers");
  await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

test("lists each supplier with its terms, and adds one once checked", async ({ page }) => {
  await open(page, { "POST /api/suppliers": json(BOOK) });
  const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Lumina Hair Co" }) });
  await expect(row).toContainText("CN · USD");
  await expect(row).toContainText(copy.terms(30));
  await expect(row).toContainText(copy.warranty(90));

  await page.getByLabel(copy.form.name, { exact: true }).fill("Kesh Supplies");
  await page.getByLabel(copy.form.gstin).fill("07aabck1234m1z5");
  await page.getByLabel(copy.form.terms).fill("15");
  await page.getByRole("button", { name: copy.form.add }).click();
  await expect(page.getByText(copy.form.confirm.adding("Kesh Supplies", "IN", "INR"))).toBeVisible();
  const sent = posted(page, "/api/suppliers");
  await page.getByRole("button", { name: copy.form.confirm.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    name: "Kesh Supplies",
    gstin: "07AABCK1234M1Z5",
    country: "IN",
    currency: "INR",
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 15,
    warranty_days: 0,
  });
  expect(await axeViolations(page)).toEqual([]);
});

test("shows what a supplier supplies, and sets a price old beside new", async ({ page }) => {
  await open(page, { "POST /api/suppliers/{id}/items": json(BOOK) });
  await page.getByRole("button", { name: copy.itemsLabel("Lumina Hair Co") }).click();
  const items = page.getByRole("region", { name: copy.item.title("Lumina Hair Co") });
  const solvent = items.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Solvent" }) });
  await expect(solvent).toContainText("USD 12.50 per ml");

  await items.getByLabel(copy.item.consumable).selectOption({ label: "Solvent" });
  await items.getByLabel(copy.item.price("USD", "ml")).fill("13");
  await items.getByRole("button", { name: copy.item.set }).click();
  await expect(items).toContainText("USD 12.50");
  await expect(items).toContainText("USD 13.00");
  const sent = posted(page, "/api/suppliers/sup-1/items");
  await items.getByRole("button", { name: copy.form.confirm.send }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "solvent",
    their_code: "SV-500",
    unit_price: 1300,
    pack_size: 12,
    minimum_order: 24,
    lead_time_days: 21,
  });
  expect(await axeViolations(page)).toEqual([]);
});

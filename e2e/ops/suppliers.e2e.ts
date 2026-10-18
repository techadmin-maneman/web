// Settings, Suppliers (docs/decisions/0165-suppliers.md): who we buy stock from and on what terms, and what each
// supplies. A row opens its record, where each value changes where it reads (docs/decisions/0212-editing-in-place.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

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
  await page.goto("/suppliers");
  await expect(page.getByRole("heading", { level: 2, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

async function recordOf(page: Page) {
  await page.getByRole("button", { name: copy.open("Lumina Hair Co") }).click();
  return page.getByRole("dialog", { name: "Lumina Hair Co" });
}

test("lists each supplier with its terms, and adds one", async ({ page }) => {
  await open(page, { "POST /api/suppliers": json(BOOK) });
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: copy.open("Lumina Hair Co") }) });
  await expect(row).toContainText("CN · USD");
  await expect(row).toContainText(copy.terms(30));
  await expect(row).toContainText(copy.warranty(90));

  await page.getByRole("button", { name: copy.form.addTitle }).click();
  const form = page.getByRole("dialog", { name: copy.form.addTitle });
  await form.getByLabel(copy.form.name, { exact: true }).fill("Kesh Supplies");
  await form.getByLabel(copy.form.gstin).fill("07aabck1234m1z5");
  await form.getByLabel(copy.form.terms).fill("15");
  const sent = posted(page, "/api/suppliers");
  await form.getByRole("button", { name: copy.form.add, exact: true }).click();
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
  await expect(page.getByRole("status").filter({ hasText: copy.added })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("changes a supplier's value where it reads, the rest sent as they stand", async ({ page }) => {
  await open(page, { "POST /api/suppliers/{id}": json(BOOK) });
  const record = await recordOf(page);
  await record.getByRole("button", { name: `${EDITING.change} ${copy.rows.terms}` }).click();
  const terms = record.getByRole("textbox", { name: copy.rows.terms });
  await expect(terms).toHaveValue("30");
  await terms.fill("45");
  const sent = posted(page, "/api/suppliers/sup-1");
  await terms.press("Enter");
  expect((await sent).postDataJSON()).toEqual({
    name: "Lumina Hair Co",
    gstin: null,
    country: "CN",
    currency: "USD",
    contact_name: "Wei Chen",
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 45,
    warranty_days: 90,
  });
});

test("retires a supplier once asked", async ({ page }) => {
  await open(page, { "POST /api/suppliers/{id}/retire": json(BOOK) });
  const record = await recordOf(page);
  await record.getByRole("button", { name: copy.retiring.label("Lumina Hair Co") }).click();
  await expect(record.getByText(copy.retiring.warning("Lumina Hair Co"))).toBeVisible();
  const sent = posted(page, "/api/suppliers/sup-1/retire");
  await record.getByRole("button", { name: copy.retiring.confirm, exact: true }).click();
  await sent;
});

test("shows what a supplier supplies, sets a price where it reads, and adds an item", async ({ page }) => {
  await open(page, { "POST /api/suppliers/{id}/items": json(BOOK) });
  const record = await recordOf(page);
  const items = record.getByRole("region", { name: copy.item.title("Lumina Hair Co") });
  await items.getByRole("button", { name: /^Solvent · USD 12.50 per ml/ }).click();

  const solvent = items.getByRole("group", { name: "Solvent" });
  await solvent.getByRole("button", { name: `${EDITING.change} ${copy.item.rows.price("ml")}` }).click();
  const price = solvent.getByRole("textbox", { name: copy.item.rows.price("ml") });
  await expect(price).toHaveValue("12.5");
  await price.fill("13");
  let sent = posted(page, "/api/suppliers/sup-1/items");
  await price.press("Enter");
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "solvent",
    their_code: "SV-500",
    unit_price: 1300,
    pack_size: 12,
    minimum_order: 24,
    lead_time_days: 21,
  });

  await items.getByRole("button", { name: copy.item.addOne }).click();
  const add = items.getByRole("group", { name: copy.item.addOne });
  await expect(add.getByLabel(copy.item.consumable)).toHaveValue("tape_strips");
  await add.getByLabel(copy.item.price("USD", "strip")).fill("0.4");
  await add.getByLabel(copy.item.lead).fill("14");
  sent = posted(page, "/api/suppliers/sup-1/items");
  await add.getByRole("button", { name: copy.form.add, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    their_code: null,
    unit_price: 40,
    pack_size: 1,
    minimum_order: 1,
    lead_time_days: 14,
  });
  expect(await axeViolations(page)).toEqual([]);
});

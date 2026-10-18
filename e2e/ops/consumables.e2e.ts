// Items: what a technician may record using on a job, what one costs us, and what each service is expected to use
// (docs/decisions/0087-consumables-and-stock.md). A row opens its record beside the list, where each value changes
// where it reads and is sent alone (docs/decisions/0212-editing-in-place.md); a refusal says which box it came from.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, CONSUMABLES, fails, json, type Answers } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { deleting, EDITING } from "../../apps/ops/src/content/common.ts";

const copy = settingsCopy.consumables;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/consumables": json(CONSUMABLES), ...extra });
  await page.goto("/items");
  await expect(page.getByRole("heading", { level: 2, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: copy.open(name), exact: true }) });

async function recordOf(page: Page, name: string) {
  await page.getByRole("button", { name: copy.open(name), exact: true }).click();
  const record = page.getByRole("dialog", { name });
  await expect(record).toBeVisible();
  return record;
}

const change = (record: ReturnType<Page["getByRole"]>, label: string) =>
  record.getByRole("button", { name: `${EDITING.change} ${label}` });

test.describe("the list", () => {
  test("gives each its cost, the levels it is low at, and whether it is offered", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle("Items · Mane Man operations");

    const tape = row(page, "Tape strips");
    await expect(tape).toContainText("strip");
    await expect(tape).toContainText("Rs. 12.50");
    await expect(tape).toContainText("Kit 5 · warehouse 50");
    await expect(tape).toContainText(copy.states.offered);
    await expect(row(page, "Solvent")).toContainText("Offered until 1 Oct 2027");
    await expect(row(page, "Shampoo sachet")).toContainText("Retired from 1 Sep 2027");
    // Tables are for finding: nothing in a row but the way to its record.
    await expect(tape.getByRole("button")).toHaveCount(1);

    const shampoo = await recordOf(page, "Shampoo sachet");
    await expect(shampoo.getByRole("button", { name: copy.restoreLabel("Shampoo sachet") })).toBeVisible();
  });
});

test.describe("a consumable added", () => {
  test("is sent in paise with its levels, an empty level as none", async ({ page }) => {
    await open(page, { "POST /api/consumables": json(CONSUMABLES) });
    await page.getByRole("button", { name: copy.add }).click();
    const add = page.getByRole("group", { name: copy.form.addTitle });
    await add.getByLabel(copy.form.name).fill("Scalp wipes");
    await add.getByLabel(copy.form.unit).fill("wipe");
    await add.getByLabel(copy.form.cost).fill("7.5");
    await add.getByLabel(copy.form.kit).fill("10");

    const sent = posted(page, "/api/consumables");
    await add.getByLabel(copy.form.kit).press("Enter");
    expect((await sent).postDataJSON()).toEqual({
      name: "Scalp wipes",
      unit: "wipe",
      unit_cost: 750,
      reorder_kit: 10,
      reorder_central: null,
      reorder_store: null,
      shelf_life_days: null,
    });
    await expect(page.getByRole("status").filter({ hasText: copy.form.added })).toBeVisible();
  });

  test("names the box the API refused, and the box a level is not whole in, before sending", async ({ page }) => {
    await open(page, { "POST /api/consumables": fails(400, "invalid_request", ["name"]) });
    await page.getByRole("button", { name: copy.add }).click();
    const add = page.getByRole("group", { name: copy.form.addTitle });
    await add.getByLabel(copy.form.name).fill("tape strips");
    await add.getByLabel(copy.form.unit).fill("strip");
    await add.getByLabel(copy.form.cost).fill("12");
    await add.getByLabel(copy.form.store).fill("2.5");
    await add.getByRole("button", { name: copy.form.add, exact: true }).click();
    await expect(add.getByLabel(copy.form.store)).toHaveAttribute("aria-invalid", "true");

    await add.getByLabel(copy.form.store).fill("");
    await add.getByRole("button", { name: copy.form.add, exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(copy.errors.name);
    await expect(add.getByLabel(copy.form.name)).toHaveValue("tape strips");
  });
});

test.describe("a consumable's record", () => {
  test("changes each value where it reads, sending only that one", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}": json(CONSUMABLES) });
    const record = await recordOf(page, "Tape strips");

    await change(record, copy.rows.name).click();
    const name = record.getByRole("textbox", { name: copy.rows.name });
    await name.fill("Contour tape");
    let sent = posted(page, "/api/consumables/tape_strips");
    await name.press("Enter");
    expect((await sent).postDataJSON()).toEqual({ name: "Contour tape" });

    await change(record, copy.rows.cost).click();
    const cost = record.getByRole("textbox", { name: copy.rows.cost });
    await expect(cost).toHaveValue("12.5");
    await cost.fill("15");
    sent = posted(page, "/api/consumables/tape_strips");
    await cost.press("Enter");
    expect((await sent).postDataJSON()).toEqual({ unit_cost: 1500 });
  });

  test("takes an emptied level as none, and says why a level that is not whole stays", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}": json(CONSUMABLES) });
    const record = await recordOf(page, "Bonding glue");

    await change(record, copy.rows.kit).click();
    const kit = record.getByRole("textbox", { name: copy.rows.kit });
    await kit.fill("2.5");
    await kit.press("Enter");
    await expect(record.getByRole("alert")).toHaveText(copy.errors.reorder_kit);

    await kit.fill("");
    const sent = posted(page, "/api/consumables/bonding_glue");
    await kit.press("Enter");
    expect((await sent).postDataJSON()).toEqual({ reorder_kit: null });
  });

  test("retires one from a day, after saying what that does and what it does not", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}/retire": json(CONSUMABLES) });
    const record = await recordOf(page, "Bonding glue");
    await record.getByRole("button", { name: copy.retireLabel("Bonding glue") }).click();
    const asking = record.getByRole("form", { name: copy.retireLabel("Bonding glue") });
    await asking.getByLabel(copy.retiring.from).fill("2027-10-15");
    await expect(asking).toContainText("can’t log Bonding glue from 15 Oct 2027");
    await expect(asking).toContainText("Past jobs keep it.");

    const sent = posted(page, "/api/consumables/bonding_glue/retire");
    await asking.getByRole("button", { name: copy.retire, exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ from: "2027-10-15" });
  });

  test("deletes one added by mistake, once asked", async ({ page }) => {
    const left = {
      ...CONSUMABLES,
      consumables: CONSUMABLES.consumables.filter((each) => each.code !== "bonding_glue"),
    };
    await open(page, { "POST /api/consumables/{code}/delete": json(left) });
    const record = await recordOf(page, "Bonding glue");
    await record.getByRole("button", { name: deleting.label("Bonding glue") }).click();
    await expect(record.getByText(deleting.warning("Bonding glue"))).toBeVisible();

    const sent = posted(page, "/api/consumables/bonding_glue/delete");
    await record.getByRole("button", { name: deleting.confirm, exact: true }).click();
    await sent;
    await expect(page.getByRole("status").filter({ hasText: copy.deleted })).toBeVisible();
    await expect(record).toBeHidden();
    await expect(row(page, "Bonding glue")).toHaveCount(0);
  });

  test("says to retire instead one whose stock has moved", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}/delete": fails(409, "in_use") });
    const record = await recordOf(page, "Bonding glue");
    await record.getByRole("button", { name: deleting.label("Bonding glue") }).click();
    await record.getByRole("button", { name: deleting.confirm, exact: true }).click();

    await expect(record.getByRole("alert")).toHaveText(copy.inUse);
  });
});

test.describe("what each service uses", () => {
  test("shows the chosen service’s figures, each changed where it reads, the list sent whole", async ({ page }) => {
    await open(page, { "POST /api/service-usage": json(CONSUMABLES) });
    const uses = page.getByRole("region", { name: copy.usage.title });
    const service = uses.getByLabel(copy.usage.service);
    // Each service by its name, a kind at a time; a retired one is still there, marked, for a visit sold before.
    await expect(service.locator("optgroup")).toHaveCount(4);
    await service.selectOption({ label: "Service visit" });

    await expect(change(uses, "Tape strips")).toContainText("4 strips");
    await expect(change(uses, "Solvent")).toContainText("10 ml");
    await expect(change(uses, "Bonding glue")).toContainText(copy.usage.none);
    // Retired, and expected by no service: nothing to set.
    await expect(change(uses, "Shampoo sachet")).toHaveCount(0);

    await change(uses, "Tape strips").click();
    const tape = uses.getByRole("textbox", { name: "Tape strips" });
    await expect(tape).toHaveValue("4");
    await tape.fill("6");
    const sent = posted(page, "/api/service-usage");
    await tape.press("Enter");
    expect((await sent).postDataJSON()).toEqual({
      visit_type: "service",
      tier: "standard",
      items: [
        { code: "solvent", quantity: 10 },
        { code: "tape_strips", quantity: 6 },
      ],
    });
  });
});

test("meets WCAG 2.2 AA, with a record open and a value being changed", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  const record = await recordOf(page, "Tape strips");
  await change(record, copy.rows.unit).click();
  await expect(record.getByRole("textbox", { name: copy.rows.unit })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
});

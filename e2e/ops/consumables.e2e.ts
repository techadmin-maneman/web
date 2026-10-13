// Settings, Consumables: what a technician may record using on a job, what one
// costs us, and what each service is
// expected to use (docs/decisions/0087-consumables-and-stock.md). As every panel
// of Settings does, it shows a change old beside new before it is sent
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and says of a
// refusal which box it came from.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, CONSUMABLES, fails, json, type Answers } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { review } from "../../apps/ops/src/content/common.ts";

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/consumables": json(CONSUMABLES), ...extra });
  await page.goto("/items");
  await expect(page.getByRole("heading", { level: 2, name: "Consumables" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });

test.describe("the list", () => {
  test("gives each its cost, the levels it is low at, and whether it is offered", async ({ page }) => {
    await open(page);
    await expect(page).toHaveTitle("Items · Mane Man operations");

    const tape = row(page, "Tape strips strip");
    await expect(tape).toContainText("Rs. 12.50");
    await expect(tape).toContainText("Kit 5 · warehouse 50");
    await expect(tape).toContainText(settingsCopy.consumables.states.offered);
    await expect(row(page, "Solvent ml")).toContainText("Offered until 1 Oct 2027");
    await expect(row(page, "Shampoo sachet sachet")).toContainText("Retired from 1 Sep 2027");
    await expect(
      row(page, "Shampoo sachet sachet").getByRole("button", { name: "Restore Shampoo sachet" }),
    ).toBeVisible();
  });
});

test.describe("a consumable added or changed", () => {
  test("is shown before it is sent, and sent in paise with its levels", async ({ page }) => {
    await open(page, { "POST /api/consumables": json(CONSUMABLES) });
    const add = page.getByRole("group", { name: settingsCopy.consumables.form.addTitle });
    await add.getByLabel("Name").fill("Scalp wipes");
    await add.getByLabel("Unit").fill("wipe");
    await add.getByLabel(settingsCopy.consumables.form.cost).fill("7.5");
    await add.getByLabel(settingsCopy.consumables.form.confirm.fields.kit).fill("10");
    await add.getByRole("button", { name: review.next, exact: true }).click();

    const check = page.getByRole("group", { name: "Review the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Scalp wipes, by the wipe, at Rs. 7.50 each.");
    await expect(check).toContainText("Kit 10");

    const sent = posted(page, "/api/consumables");
    await check.getByRole("button", { name: "Confirm" }).click();
    expect((await sent).postDataJSON()).toEqual({
      name: "Scalp wipes",
      unit: "wipe",
      unit_cost: 750,
      reorder_kit: 10,
      reorder_central: null,
      reorder_store: null,
      shelf_life_days: null,
    });
    await expect(page.getByRole("status").filter({ hasText: settingsCopy.consumables.form.added })).toBeVisible();
  });

  test("changed, shows each field old beside new", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}": json(CONSUMABLES) });
    await page.getByRole("button", { name: "Change Tape strips" }).click();

    const form = page.getByRole("group", { name: "Change Tape strips" });
    await expect(form.getByLabel(settingsCopy.consumables.form.cost)).toHaveValue("12.5");
    await form.getByLabel("Name").fill("Contour tape");
    await form.getByLabel(settingsCopy.consumables.form.cost).fill("15");
    await page.getByRole("group", { name: "Change Tape strips" }).getByRole("button", { name: review.next }).click();

    const check = page.getByRole("group", { name: "Review the change" });
    await expect(check).toContainText("Name: Tape strips → Contour tape");
    await expect(check).toContainText("Cost each: Rs. 12.50 → Rs. 15");
    const sent = posted(page, "/api/consumables/tape_strips");
    await check.getByRole("button", { name: "Confirm" }).click();
    expect((await sent).postDataJSON()).toMatchObject({ name: "Contour tape", unit_cost: 1500 });
  });

  test("sends nothing when nothing has changed", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Change Solvent" }).click();
    await page.getByRole("group", { name: "Change Solvent" }).getByRole("button", { name: review.next }).click();

    const check = page.getByRole("group", { name: "Review the change" });
    await expect(check).toContainText("No changes.");
    await expect(check.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  test("names the box the API refused", async ({ page }) => {
    await open(page, { "POST /api/consumables": fails(400, "invalid_request", ["name"]) });
    const add = page.getByRole("group", { name: settingsCopy.consumables.form.addTitle });
    await add.getByLabel("Name").fill("tape strips");
    await add.getByLabel("Unit").fill("strip");
    await add.getByLabel(settingsCopy.consumables.form.cost).fill("12");
    await add.getByRole("button", { name: review.next, exact: true }).click();
    await page.getByRole("button", { name: "Confirm" }).click();

    await expect(page.getByRole("alert")).toHaveText("That name is taken, or doesn't start with a letter or digit.");
  });

  test("retires one from a day, after saying what that does and what it does not", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}/retire": json(CONSUMABLES) });
    await page.getByRole("button", { name: "Retire Bonding glue" }).click();
    await page.getByLabel(settingsCopy.consumables.retiring.from).fill("2027-10-15");
    await page.getByRole("group", { name: "Retire Bonding glue" }).getByRole("button", { name: review.next }).click();

    const check = page.getByRole("group", { name: "Review the change" });
    await expect(check).toContainText("can't log Bonding glue from 15 Oct 2027");
    await expect(check).toContainText("Past jobs keep it.");
    const sent = posted(page, "/api/consumables/bonding_glue/retire");
    await check.getByRole("button", { name: "Confirm" }).click();
    expect((await sent).postDataJSON()).toEqual({ from: "2027-10-15" });
  });
});

test.describe("deleting one", () => {
  test("deletes one added by mistake, once asked", async ({ page }) => {
    const left = {
      ...CONSUMABLES,
      consumables: CONSUMABLES.consumables.filter((each) => each.code !== "bonding_glue"),
    };
    await open(page, { "POST /api/consumables/{code}/delete": json(left) });
    await page.getByRole("button", { name: "Delete Bonding glue" }).click();
    await expect(page.getByText("Delete Bonding glue? This can't be undone.")).toBeVisible();

    const sent = posted(page, "/api/consumables/bonding_glue/delete");
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await sent;
    await expect(page.getByRole("status").filter({ hasText: "Deleted." })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /^Bonding glue/ })).toHaveCount(0);
  });

  test("says to retire instead one whose stock has moved", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}/delete": fails(409, "in_use") });
    await page.getByRole("button", { name: "Delete Bonding glue" }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page.getByRole("alert")).toHaveText(settingsCopy.consumables.inUse);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("what each service uses", () => {
  test("shows the chosen service's figures, and the change old beside new before it is sent", async ({ page }) => {
    await open(page, { "POST /api/service-usage": json(CONSUMABLES) });
    const uses = page.getByRole("region", { name: settingsCopy.consumables.usage.title });
    // Each service by its name, a kind at a time; a retired one is still there, marked, for a visit sold before.
    await expect(uses.getByLabel("Service").locator("optgroup")).toHaveCount(4);
    await expect(uses.getByLabel("Service").locator("option")).toHaveText([
      "Consultation",
      "First fit",
      "Premium first fit, retired from 1 Oct 2027",
      "Service visit",
      "Replacement",
    ]);
    await uses.getByLabel("Service").selectOption({ label: "Service visit" });

    await expect(uses.getByLabel("Tape strips, strip per visit")).toHaveValue("4");
    await expect(uses.getByLabel("Solvent, ml per visit")).toHaveValue("10");
    await expect(uses.getByLabel("Bonding glue, ml per visit")).toHaveValue("");
    // Retired, and expected by no service: nothing to set.
    await expect(uses.getByLabel("Shampoo sachet, sachet per visit")).toHaveCount(0);

    await uses.getByLabel("Tape strips, strip per visit").fill("6");
    await uses.getByLabel("Solvent, ml per visit").fill("");
    await uses.getByLabel("Bonding glue, ml per visit").fill("3");
    await uses.getByRole("button", { name: review.next }).click();

    const check = uses.getByRole("group", { name: "Review the change" });
    await expect(check).toContainText("Bonding glue: none → 3 ml");
    await expect(check).toContainText("Solvent: 10 ml → none");
    await expect(check).toContainText("Tape strips: 4 strip → 6 strip");
    const sent = posted(page, "/api/service-usage");
    await check.getByRole("button", { name: "Confirm" }).click();
    expect((await sent).postDataJSON()).toEqual({
      visit_type: "service",
      tier: "standard",
      items: [
        { code: "bonding_glue", quantity: 3 },
        { code: "tape_strips", quantity: 6 },
      ],
    });
  });
});

test.describe("hair systems", () => {
  const words = settingsCopy.consumables.hairSystems;
  const panel = (page: Page) => page.getByRole("region", { name: words.title });

  test("adds one by its spec, and reads the list again with it in", async ({ page }) => {
    await open(page, { "POST /api/hair-systems": json({ code: "hs_standard_8x10_1b_g20_d100" }) });
    const form = panel(page);
    await form.getByLabel(words.product).selectOption({ label: "First fit" });
    await form.getByLabel(words.width).fill("8");
    await form.getByLabel(words.length).fill("10");
    await form.getByLabel(words.colour).selectOption("1B");
    await form.getByLabel(words.grey).fill("20");
    await form.getByLabel(words.density).selectOption("100");
    await form.getByLabel(words.cost).fill("12000");
    const sent = posted(page, "/api/hair-systems");
    const reread = page.waitForRequest((request) => request.url().endsWith("/api/consumables"));
    await form.getByRole("button", { name: review.next }).click();
    await form.getByRole("button", { name: review.send }).click();
    expect((await sent).postDataJSON()).toEqual({
      product: "standard",
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 20,
      density_percent: 100,
      unit_cost: 1_200_000,
      reorder_kit: null,
      reorder_central: null,
      reorder_store: null,
    });
    await reread;
    await expect(page.getByRole("status")).toHaveText(words.added);
  });

  test("says when the spec is in stock already", async ({ page }) => {
    await open(page, { "POST /api/hair-systems": fails(400, "invalid_request", ["hair_system"]) });
    const form = panel(page);
    await form.getByLabel(words.width).fill("8");
    await form.getByLabel(words.length).fill("10");
    await form.getByLabel(words.cost).fill("12000");
    await form.getByRole("button", { name: review.next }).click();
    await form.getByRole("button", { name: review.send }).click();
    await expect(form.getByRole("alert")).toHaveText(words.errors.hair_system ?? "");
  });
});

test("meets WCAG 2.2 AA, with a change being checked as well", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Change Tape strips" }).click();
  await page.getByRole("group", { name: "Change Tape strips" }).getByLabel("Unit").fill("strips");
  await page.getByRole("group", { name: "Change Tape strips" }).getByRole("button", { name: review.next }).click();
  await expect(page.getByRole("group", { name: "Review the change" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

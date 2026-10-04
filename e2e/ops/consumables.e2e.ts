// Settings, Consumables: what a technician may record using on a job, what one
// costs us, and what each service is
// expected to use (docs/decisions/0087-consumables-and-stock.md). As every panel
// of Settings does, it shows a change old beside new before it is sent
// (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and says of a
// refusal which box it came from.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, CONSUMABLES, fails, json, type Answers } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/consumables": json(CONSUMABLES), ...extra });
  await page.goto("/settings/consumables");
  await expect(page.getByRole("heading", { level: 2, name: "Consumables" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });

test.describe("the list", () => {
  test("gives each its cost, the levels it is low at, and whether it is offered", async ({
    page,
  }) => {
    await open(page);
    await expect(page).toHaveTitle("Consumables · Settings · Mane Man operations");

    const tape = row(page, "Tape strips strip");
    await expect(tape).toContainText("Rs. 12.50");
    await expect(tape).toContainText("Kit 5 · store 50");
    await expect(tape).toContainText("Offered");
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
    const add = page.getByRole("group", { name: "Add a consumable" });
    await add.getByLabel("Name").fill("Scalp wipes");
    await add.getByLabel("Unit").fill("wipe");
    await add.getByLabel("Cost of one, in rupees").fill("7.5");
    await add.getByLabel("A kit is low at").fill("10");
    await page.getByRole("button", { name: "Add this consumable" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Scalp wipes, counted in wipe, at Rs. 7.50 each.");
    await expect(check).toContainText("Kit 10");

    const sent = posted(page, "/api/consumables");
    await check.getByRole("button", { name: "Save it" }).click();
    expect((await sent).postDataJSON()).toEqual({
      name: "Scalp wipes",
      unit: "wipe",
      unit_cost: 750,
      reorder_kit: 10,
      reorder_central: null,
    });
    await expect(page.getByRole("status").filter({ hasText: "The consumable is added." })).toBeVisible();
  });

  test("changed, shows each field old beside new", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}": json(CONSUMABLES) });
    await page.getByRole("button", { name: "Change Tape strips" }).click();

    const form = page.getByRole("group", { name: "Change Tape strips" });
    await expect(form.getByLabel("Cost of one, in rupees")).toHaveValue("12.5");
    await form.getByLabel("Name").fill("Contour tape");
    await form.getByLabel("Cost of one, in rupees").fill("15");
    await page.getByRole("button", { name: "Save the change" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toContainText("Name: Tape strips → Contour tape");
    await expect(check).toContainText("Cost of one: Rs. 12.50 → Rs. 15");
    const sent = posted(page, "/api/consumables/tape_strips");
    await check.getByRole("button", { name: "Save it" }).click();
    expect((await sent).postDataJSON()).toMatchObject({ name: "Contour tape", unit_cost: 1500 });
  });

  test("sends nothing when nothing has changed", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Change Solvent" }).click();
    await page.getByRole("button", { name: "Save the change" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toContainText("Nothing has changed.");
    await expect(check.getByRole("button", { name: "Save it" })).toBeDisabled();
  });

  test("names the box the API refused", async ({ page }) => {
    await open(page, { "POST /api/consumables": fails(400, "invalid_request", ["name"]) });
    const add = page.getByRole("group", { name: "Add a consumable" });
    await add.getByLabel("Name").fill("tape strips");
    await add.getByLabel("Unit").fill("strip");
    await add.getByLabel("Cost of one, in rupees").fill("12");
    await page.getByRole("button", { name: "Add this consumable" }).click();
    await page.getByRole("button", { name: "Save it" }).click();

    await expect(page.getByRole("alert")).toHaveText(
      "Another consumable has that name, or it does not start with a letter or a digit. Nothing was changed.",
    );
  });

  test("retires one from a day, after saying what that does and what it does not", async ({ page }) => {
    await open(page, { "POST /api/consumables/{code}/retire": json(CONSUMABLES) });
    await page.getByRole("button", { name: "Retire Bonding glue" }).click();
    await page.getByLabel("No longer offered from").fill("2027-10-15");
    await page.getByRole("button", { name: "Retire it" }).click();

    const check = page.getByRole("group", { name: "Check the change" });
    await expect(check).toContainText("stops offering Bonding glue from 15 Oct 2027");
    await expect(check).toContainText("A job that already recorded it keeps it.");
    const sent = posted(page, "/api/consumables/bonding_glue/retire");
    await check.getByRole("button", { name: "Retire it" }).click();
    expect((await sent).postDataJSON()).toEqual({ from: "2027-10-15" });
  });
});

test.describe("what each service uses", () => {
  test("shows the chosen service's figures, and the change old beside new before it is sent", async ({ page }) => {
    await open(page, { "POST /api/service-usage": json(CONSUMABLES) });
    const uses = page.getByRole("region", { name: "What each service uses" });
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

    await expect(uses.getByLabel("Tape strips, strip a visit")).toHaveValue("4");
    await expect(uses.getByLabel("Solvent, ml a visit")).toHaveValue("10");
    await expect(uses.getByLabel("Bonding glue, ml a visit")).toHaveValue("");
    // Retired, and expected by no service: nothing to set.
    await expect(uses.getByLabel("Shampoo sachet, sachet a visit")).toHaveCount(0);

    await uses.getByLabel("Tape strips, strip a visit").fill("6");
    await uses.getByLabel("Solvent, ml a visit").fill("");
    await uses.getByLabel("Bonding glue, ml a visit").fill("3");
    await uses.getByRole("button", { name: "Save this service's use" }).click();

    const check = uses.getByRole("group", { name: "Check the change" });
    await expect(check).toContainText("Bonding glue: none → 3 ml");
    await expect(check).toContainText("Solvent: 10 ml → none");
    await expect(check).toContainText("Tape strips: 4 strip → 6 strip");
    const sent = posted(page, "/api/service-usage");
    await check.getByRole("button", { name: "Save it" }).click();
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

test("meets WCAG 2.2 AA, with a change being checked as well", async ({ page }) => {
  await open(page);
  let results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("button", { name: "Change Tape strips" }).click();
  await page.getByRole("group", { name: "Change Tape strips" }).getByLabel("Unit").fill("strips");
  await page.getByRole("button", { name: "Save the change" }).click();
  await expect(page.getByRole("group", { name: "Check the change" })).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

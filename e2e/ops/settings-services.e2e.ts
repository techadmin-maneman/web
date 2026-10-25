// Settings' prices: the consultation and the late fees (docs/decisions/0085-services-ops-can-edit.md), and the packages,
// each with its hair systems, service visit and replacement (docs/decisions/0211-packages.md). Every value changes where
// it reads, and is sent only on Enter or Save (docs/decisions/0212-editing-in-place.md); a refusal is said of the box it
// was refused for.
//
// The refusals are the API's own shape: invalid_request, with the fields it names (src/http/errors.ts).

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fails, json, PACKAGES, PRICE_ROWS, SERVICES } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { packagesCopy } from "../../apps/ops/src/content/packages.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";

const change = (scope: Locator, label: string) =>
  scope.getByRole("button", { name: `${EDITING.change} ${label}`, exact: true });

const panel = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

test.describe("the consultation and the late fees", () => {
  test("lists the consultation's name, length and price, and each late fee, and no other kind", async ({ page }) => {
    await open(page, "/settings/services");
    const consultation = panel(page, settingsCopy.services.consultation);
    const named = SERVICES.services.find((service) => service.kind === "consultation")?.name ?? "";
    await expect(change(consultation, settingsCopy.services.rows.name)).toContainText(named);
    await expect(change(consultation, settingsCopy.services.rows.length)).toContainText("60 min");
    await expect(change(consultation, settingsCopy.services.rows.price)).toContainText("Rs. 0");
    const fees = panel(page, settingsCopy.services.lateFees);
    await expect(change(fees, settingsCopy.services.lateFeeNames.late_fee_first_fit)).toContainText("Rs. 4,000");
    await expect(page.getByRole("main")).not.toContainText("Premium");
    expect(await axeViolations(page)).toEqual([]);
  });

  test("sets a price from tomorrow, its GST as it was, and offers no earlier day", async ({ page }) => {
    await open(page, "/settings/services", { "POST /api/prices": json({ prices: PRICE_ROWS }) });
    const fees = panel(page, settingsCopy.services.lateFees);
    await change(fees, settingsCopy.services.lateFeeNames.late_fee_first_fit).click();
    await expect(fees.getByLabel(packagesCopy.price.amount)).toHaveValue("4000");
    await expect(fees.getByLabel(packagesCopy.price.gst)).toHaveValue("0");
    const from = fees.getByLabel(packagesCopy.price.from);
    await expect(from).toHaveValue("2027-09-22");
    await expect(from).toHaveAttribute("min", "2027-09-22");

    await fees.getByLabel(packagesCopy.price.amount).fill("4500");
    const request = posted(page, "/api/prices");
    await fees.getByRole("button", { name: EDITING.save }).click();
    expect((await request).postDataJSON()).toEqual({
      item: "late_fee_first_fit",
      tier: "standard",
      amount_ex_gst: 450_000,
      gst_percent: 0,
      valid_from: "2027-09-22",
    });
  });

  test("says why a price is refused under its boxes, and keeps them open", async ({ page }) => {
    await open(page, "/settings/services", { "POST /api/prices": fails(400, "invalid_request", ["valid_from"]) });
    const consultation = panel(page, settingsCopy.services.consultation);
    await change(consultation, settingsCopy.services.rows.price).click();
    await consultation.getByRole("button", { name: EDITING.save }).click();
    await expect(consultation.getByRole("alert")).toHaveText(packagesCopy.errors.valid_from);
    await expect(consultation.getByLabel(packagesCopy.price.amount)).toBeVisible();
  });

  test("renames the consultation where it reads", async ({ page }) => {
    await open(page, "/settings/services", {
      "POST /api/services/consultation/standard/name": json({
        ...SERVICES,
        services: SERVICES.services.map((each) =>
          each.kind === "consultation" ? { ...each, name: "Home consultation" } : each,
        ),
      }),
    });
    const consultation = panel(page, settingsCopy.services.consultation);
    await change(consultation, settingsCopy.services.rows.name).click();
    await consultation.getByLabel(settingsCopy.services.rows.name).fill("Home consultation");
    const request = posted(page, "/api/services/consultation/standard/name");
    await consultation.getByLabel(settingsCopy.services.rows.name).press("Enter");
    expect((await request).postDataJSON()).toEqual({ name: "Home consultation" });
    await expect(change(consultation, settingsCopy.services.rows.name)).toContainText("Home consultation");
  });
});

test.describe("the packages", () => {
  const opened = async (page: Page, name: string) => {
    await page.getByRole("button", { name: packagesCopy.open(name), exact: true }).click();
    return panel(page, name);
  };

  // Prices were text ("From Rs. 32,000, with its service visit") that hid their parts, and nothing showed a margin.
  test("lists each part of a package in a column of its own, what a first fit comes to, its cost and margin", async ({
    page,
  }) => {
    await open(page, "/settings/packages");
    const list = panel(page, packagesCopy.title);
    const essential = list.getByRole("row").filter({ hasText: "Mane Man Essential" });
    await expect(essential.getByRole("cell")).toHaveText([
      "Rs. 29,800",
      "Rs. 2,200",
      "30 days",
      "Rs. 32,000",
      "Rs. 12,800",
      "6 months",
      "Rs. 8,000",
      "Rs. 24,000",
      packagesCopy.status.sold,
    ]);
    await expect(essential).toContainText(packagesCopy.status.sold);
    await expect(list.getByRole("row").filter({ hasText: "Mane Man Natural" })).toContainText(
      packagesCopy.status.unpriced,
    );
    expect(await axeViolations(page)).toEqual([]);
  });

  test("opens a package's record beneath the list, each part's figures changed in place", async ({ page }) => {
    await open(page, "/settings/packages", { "PATCH /api/packages/essential": json(PACKAGES) });
    const record = await opened(page, "Mane Man Essential");
    await expect(record).toContainText(`${packagesCopy.rows.hairSystemFrom}Rs. 29,800`);
    await expect(record).toContainText(`${packagesCopy.rows.firstFitTotal}Rs. 32,000`);
    await expect(record).toContainText("Rs. 2,500 from Fri 1 Oct");

    const every = record.getByRole("button", { name: `${EDITING.change} ${packagesCopy.rows.every}` });
    await every.click();
    const box = record.getByLabel(packagesCopy.rows.every);
    await expect(box).toHaveValue("30");
    await box.fill("21");
    const request = page.waitForRequest(
      (asked) => asked.url().endsWith("/api/packages/essential") && asked.method() === "PATCH",
    );
    await box.press("Enter");
    expect((await request).postDataJSON()).toEqual({ service_every_days: 21 });
    expect(await axeViolations(page)).toEqual([]);
  });

  test("says why a change is refused under its box", async ({ page }) => {
    await open(page, "/settings/packages", {
      "PATCH /api/packages/essential": fails(400, "invalid_request", ["service_every_days"]),
    });
    const record = await opened(page, "Mane Man Essential");
    await record.getByRole("button", { name: `${EDITING.change} ${packagesCopy.rows.every}` }).click();
    await record.getByLabel(packagesCopy.rows.every).fill("120");
    await record.getByRole("button", { name: EDITING.save }).click();
    await expect(record.getByRole("alert")).toHaveText(packagesCopy.errors.service_every_days);
  });

  test("adds a package by its name, and opens its record", async ({ page }) => {
    const added = {
      ...PACKAGES,
      packages: [...PACKAGES.packages, { ...PACKAGES.packages[1], code: "mane_man_active", name: "Mane Man Active" }],
    };
    await open(page, "/settings/packages", { "POST /api/packages": json(added, 201) });
    await page.getByRole("button", { name: packagesCopy.add }).click();
    await page.getByLabel(packagesCopy.name).fill("Mane Man Active");
    const request = posted(page, "/api/packages");
    await page.getByRole("button", { name: packagesCopy.create, exact: true }).click();
    expect((await request).postDataJSON()).toEqual({ name: "Mane Man Active" });
    await expect(panel(page, "Mane Man Active")).toBeVisible();
  });

  test("deletes a package never sold, once asked, and keeps one sold to retire", async ({ page }) => {
    await open(page, "/settings/packages");
    const sold = await opened(page, "Mane Man Essential");
    await expect(sold.getByRole("button", { name: `${packagesCopy.foot.delete} Mane Man Essential` })).toHaveCount(0);
    await expect(sold.getByRole("button", { name: `${packagesCopy.foot.retire} Mane Man Essential` })).toBeVisible();

    const fresh = await opened(page, "Mane Man Natural");
    await fresh.getByRole("button", { name: `${packagesCopy.foot.delete} Mane Man Natural` }).click();
    await expect(fresh).toContainText(packagesCopy.foot.deleteAsk("Mane Man Natural"));
  });

  test("adds a hair system to a package by its spec and its cost, and reads the package again", async ({ page }) => {
    await open(page, "/settings/packages", {
      "POST /api/hair-systems": json({ code: "hs_natural_8x10_1b_g20_d100" }),
    });
    const record = await opened(page, "Mane Man Natural");
    await expect(record).toContainText(packagesCopy.hairSystems.none);
    await record.getByRole("button", { name: packagesCopy.hairSystems.add }).click();
    const form = record.getByRole("form", { name: packagesCopy.hairSystems.addTitle });
    await form.getByLabel(packagesCopy.hairSystems.width).fill("8");
    await form.getByLabel(packagesCopy.hairSystems.length).fill("10");
    await form.getByLabel(packagesCopy.hairSystems.grey).fill("20");
    await form.getByLabel(packagesCopy.hairSystems.cost).fill("12000");
    const sent = posted(page, "/api/hair-systems");
    const reread = page.waitForRequest((request) => request.url().endsWith("/api/packages"));
    await form.getByRole("button", { name: packagesCopy.hairSystems.create }).click();
    expect((await sent).postDataJSON()).toEqual({
      product: "natural",
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 20,
      density_percent: 100,
      unit_cost: 1_200_000,
    });
    await reread;
  });

  test("says when the spec is in stock already", async ({ page }) => {
    await open(page, "/settings/packages", {
      "POST /api/hair-systems": fails(400, "invalid_request", ["hair_system"]),
    });
    const record = await opened(page, "Mane Man Natural");
    await record.getByRole("button", { name: packagesCopy.hairSystems.add }).click();
    const form = record.getByRole("form", { name: packagesCopy.hairSystems.addTitle });
    await form.getByLabel(packagesCopy.hairSystems.width).fill("8");
    await form.getByLabel(packagesCopy.hairSystems.length).fill("10");
    await form.getByLabel(packagesCopy.hairSystems.cost).fill("12000");
    await form.getByRole("button", { name: packagesCopy.hairSystems.create }).click();
    await expect(form.getByRole("alert")).toHaveText(packagesCopy.errors.hair_system);
  });

  test("lists a package's hair systems, and opens one's price and cost in place", async ({ page }) => {
    await open(page, "/settings/packages");
    const record = await opened(page, "Mane Man Essential");
    const spec = packagesCopy.hairSystems.spec({
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 0,
      density_percent: 100,
    });
    await expect(record.getByRole("row").filter({ hasText: spec })).toContainText("Rs. 29,800");
    await record.getByRole("button", { name: packagesCopy.hairSystems.open(spec) }).click();
    const piece = record.getByRole("group", { name: PACKAGES.packages[0]?.hair_systems[0]?.name ?? "" });
    await expect(change(piece, packagesCopy.hairSystems.columns.cost)).toContainText("Rs. 8,000");
    // Stocked before, it may be retired, never deleted.
    await expect(piece.getByRole("button", { name: new RegExp(`^${packagesCopy.hairSystems.delete} `) })).toHaveCount(
      0,
    );
  });
});

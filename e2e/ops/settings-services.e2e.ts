// Settings: the business inputs ops set for themselves
// (docs/decisions/0061-ops-editable-inputs.md). Three panels, and the thing
// each one has to get right is the same: say the unit and the bounds before
// anything is typed, show a change that cannot quietly be taken back before it
// is made (docs/decisions/0071-what-ops-see-before-a-setting-changes.md), and
// say what went wrong, of the box it went wrong in, when a figure is refused.
//
// The refusals are the API's own shape: invalid_request, with the fields it
// names (src/http/errors.ts).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { fails, json, PRICE_ROWS, SERVICES } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";

// The services clients book, kind by kind, each with its prices (docs/decisions/0085-services-ops-can-edit.md). A
// price is still a row from its day, shown in force, to come and spent; a service is added, renamed, timed, retired,
// restored and moved, and every change shows what it was beside what it will be before it is sent.
test.describe("the services and their prices", () => {
  const block = (page: Page, name: string) =>
    page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });

  test("lists each kind's services with their length, and whether they are offered", async ({ page }) => {
    await open(page, "/prices");
    for (const kind of ["Consultation", "First fit", "Service visit", "Replacement"]) {
      await expect(page.getByRole("heading", { level: 3, name: kind, exact: true })).toBeVisible();
    }
    await expect(block(page, "Service visit")).toContainText("90 min · standard · Offered");
    await expect(block(page, "Premium")).toContainText("240 min · premium");
    await expect(block(page, "Lace replacement")).toContainText("Retired from 1 Sep 2027");
  });

  test("marks the price in force, and the one still to come, in words, and folds the spent ones away", async ({
    page,
  }) => {
    await open(page, "/prices");
    const visit = block(page, "Service visit");
    await expect(visit).toContainText("Rs. 2,000 + 18% GST since 22 Sep 2026");
    await expect(visit).toContainText("Rs. 2,500 + 18% GST from 1 Oct 2027");
    await expect(visit.getByRole("row").filter({ hasText: "Rs. 1,500" })).toBeHidden();
    await visit.getByText("1 earlier price").click();
    await expect(visit.getByRole("row").filter({ hasText: "Rs. 1,500" })).toContainText("1 Jan 2026");
  });

  // GST opened at nought and the amount blank, whatever the item, so an 18% item was saved GST-free.
  test("starts a new price from the price in force, its GST included", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("2000");
    await expect(page.getByLabel("GST", { exact: true })).toHaveValue("18");
  });

  // A new price once started from today, and changed what clients had been quoted that day.
  test("starts a new price from tomorrow, and offers no earlier day", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    const from = page.getByLabel("Starts");
    await expect(from).toHaveValue("2027-09-22");
    await expect(from).toHaveAttribute("min", "2027-09-22");
  });

  test("shows the old price beside the new, and GST changing, before anything is sent", async ({ page }) => {
    let sent = 0;
    await open(page, "/prices", {
      "POST /api/prices": (route) => {
        sent += 1;
        return json({ prices: PRICE_ROWS })(route);
      },
    });
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByLabel("Price before GST, in rupees").fill("2500");
    await page.getByLabel("GST", { exact: true }).fill("0");
    await page.getByLabel("Starts").fill("2027-11-01");
    await page.getByRole("button", { name: "Review" }).click();

    const check = page.getByRole("group", { name: "Review the change" });
    await expect(check).toBeFocused();
    await expect(check).toContainText("Service visit: Rs. 2,000 + 18% GST → Rs. 2,500 + 0% GST, from 1 Nov 2027.");
    await expect(check).toContainText("GST: 18% → 0%.");
    expect(sent).toBe(0);

    const request = posted(page, "/api/prices");
    await check.getByRole("button", { name: "Set price" }).click();
    expect((await request).postDataJSON()).toEqual({
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 0,
      valid_from: "2027-11-01",
    });
    await expect(page.getByRole("status").filter({ hasText: "Price set." })).toBeVisible();
  });

  test("goes back to the form without sending when the change is not the one meant", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review" })).toBeEnabled();
  });

  // A day typed before tomorrow reached the check, and was refused only when sent.
  test("refuses a day before tomorrow beside the box, before anything is checked", async ({ page }) => {
    await open(page, "/prices");
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    const from = page.getByLabel("Starts");
    await from.fill("2027-09-21");
    await expect(from).toHaveAttribute("aria-invalid", "true");
    await expect(from).toHaveAccessibleDescription("Choose tomorrow or later.");
    await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  test("says a price applies from tomorrow at the earliest when the API refuses the date", async ({ page }) => {
    await open(page, "/prices", {
      "POST /api/prices": fails(400, "invalid_request", ["valid_from"]),
    });
    await page.getByRole("button", { name: "Change the price of Service visit" }).click();
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("group", { name: "Review the change" }).getByRole("button", { name: "Set price" }).click();
    await expect(page.getByRole("alert")).toContainText("starts tomorrow at the earliest");
  });

  test("says why a price for a retired service is refused", async ({ page }) => {
    await open(page, "/prices", { "POST /api/prices": fails(400, "service_retired", ["valid_from"]) });
    await page.getByRole("button", { name: "Change the price of Premium" }).click();
    await page.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Set price" }).click();
    await expect(page.getByRole("alert")).toContainText("It's retired by then");
  });

  test("takes back a price still to come, once asked", async ({ page }) => {
    const left = PRICE_ROWS.filter((price) => price.valid_from !== "2027-10-01");
    await open(page, "/prices", { "POST /api/prices/withdraw": json({ prices: left }) });
    await page.getByRole("button", { name: "Withdraw the Service visit price from 1 Oct 2027" }).click();
    const asked = page.getByRole("group", { name: /Withdraw the price from 1 Oct 2027/ });
    await expect(asked).toBeFocused();

    const request = posted(page, "/api/prices/withdraw");
    await asked.getByRole("button", { name: "Confirm withdrawal" }).click();
    expect((await request).postDataJSON()).toEqual({ item: "service", tier: "standard", valid_from: "2027-10-01" });
    await expect(block(page, "Service visit")).not.toContainText("Rs. 2,500");
    await expect(page.getByRole("status").filter({ hasText: "Price withdrawn." })).toBeVisible();
  });

  test("corrects a price still to come in one go, from the day it had or another", async ({ page }) => {
    await open(page, "/prices", { "POST /api/prices/correct": json({ prices: PRICE_ROWS }) });
    await page.getByRole("button", { name: "Correct the Service visit price from 1 Oct 2027" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("2500");
    await expect(page.getByLabel("Starts")).toHaveValue("2027-10-01");
    await page.getByLabel("Starts").fill("2027-10-05");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText(
      "Service visit: Rs. 2,500 + 18% GST from 1 Oct 2027 → Rs. 2,500 + 18% GST from 5 Oct 2027.",
    );

    const request = posted(page, "/api/prices/correct");
    await page.getByRole("button", { name: "Set price" }).click();
    expect((await request).postDataJSON()).toEqual({
      item: "service",
      tier: "standard",
      amount_ex_gst: 250_000,
      gst_percent: 18,
      valid_from: "2027-10-05",
      was_valid_from: "2027-10-01",
    });
  });

  test("offers no way to take back or correct the price in force or a spent one", async ({ page }) => {
    await open(page, "/prices");
    await expect(page.getByRole("button", { name: /^Withdraw/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Correct/ })).toHaveCount(1);
  });

  test("adds a hair system to the first fit, its code made from its name and its length its kind's", async ({
    page,
  }) => {
    await open(page, "/prices", { "POST /api/services": json(SERVICES, 201) });
    await expect(page.getByText("First fits are booked as one of these hair systems")).toBeVisible();
    await page.getByRole("button", { name: "Add a hair system" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Thin skin");
    await expect(page.getByLabel("Code")).toHaveValue("thin_skin");
    await expect(page.getByLabel("Length, in minutes")).toHaveValue("180");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText(
      "Add Thin skin to First fit: 180 minutes, code thin_skin. Hidden until priced.",
    );

    const request = posted(page, "/api/services");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({
      kind: "first_fit",
      name: "Thin skin",
      tier: "thin_skin",
      minutes: 180,
    });
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("renames a service and says its code, and so its prices, stay", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/name": json(SERVICES) });
    await page.getByRole("button", { name: "Rename Premium" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Premium first fit");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText(
      "Premium → Premium first fit. The code stays premium",
    );
    const request = posted(page, "/api/services/first_fit/premium/name");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({ name: "Premium first fit" });
  });

  test("gives a service the line clients read under its name, shown beside the one it replaces", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/description": json(SERVICES) });
    await expect(page.getByText("Clients see: “A finer lace front, for a closer look.”")).toBeVisible();
    await page.getByRole("button", { name: "Edit the description of Premium" }).click();
    await expect(page.getByLabel("Description", { exact: true })).toHaveAttribute("maxlength", "160");
    await page.getByLabel("Description", { exact: true }).fill("Natural, even at the parting.");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText(
      "Premium: “A finer lace front, for a closer look.” → “Natural, even at the parting.”",
    );
    const request = posted(page, "/api/services/first_fit/premium/description");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({ description: "Natural, even at the parting." });
  });

  test("gives a service another length, inside what the day holds", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/premium/length": json(SERVICES) });
    await page.getByRole("button", { name: "Change the length of Premium" }).click();
    await expect(page.getByLabel("Length, in minutes")).toHaveAttribute("max", "360");
    await page.getByLabel("Length, in minutes").fill("300");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText("Premium: 240 → 300 minutes.");
    const request = posted(page, "/api/services/first_fit/premium/length");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({ minutes: 300 });
  });

  test("retires a service from a day, and says why a kind's last one stays", async ({ page }) => {
    await open(page, "/prices", {
      "POST /api/services/replacement/standard/retire": fails(409, "last_of_kind"),
    });
    await page.getByRole("button", { name: "Retire Replacement" }).click();
    await page.getByLabel("Hidden from").fill("2027-10-01");
    await page.getByRole("button", { name: "Review" }).click();
    await expect(page.getByRole("group", { name: "Review the change" })).toContainText(
      "Replacement is hidden from 1 Oct 2027. Visits already sold aren't affected.",
    );
    const request = posted(page, "/api/services/replacement/standard/retire");
    await page.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({ from: "2027-10-01" });
    await expect(page.getByRole("alert")).toContainText("Each kind needs one priced service");
  });

  test("offers a retired service again, once asked", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/replacement/lace/restore": json(SERVICES) });
    await page.getByRole("button", { name: "Restore Lace replacement" }).click();
    const asked = page.getByRole("group", { name: /Offer Lace replacement again/ });
    await expect(asked).toBeFocused();
    const request = posted(page, "/api/services/replacement/lace/restore");
    await asked.getByRole("button", { name: "Confirm" }).click();
    await request;
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  });

  test("moves a service up its kind, showing the new order before it is sent", async ({ page }) => {
    await open(page, "/prices", { "POST /api/services/first_fit/order": json(SERVICES) });
    await expect(page.getByRole("button", { name: "Move First fit up" })).toHaveCount(0);
    await page.getByRole("button", { name: "Move Premium up" }).click();
    const asked = page.getByRole("group", { name: "First fit: First fit, Premium → Premium, First fit." });
    await expect(asked).toBeFocused();
    const request = posted(page, "/api/services/first_fit/order");
    await asked.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({ tiers: ["premium", "standard"] });
  });

  test("prices a late fee beside its kind, one figure a kind", async ({ page }) => {
    await open(page, "/prices");
    const fee = block(page, "Late fee on a first fit");
    await expect(fee).toContainText("Rs. 4,000 + 0% GST since 22 Sep 2026");
    await fee.getByRole("button", { name: "Change the price of Late fee on a first fit" }).click();
    await expect(page.getByLabel("Price before GST, in rupees")).toHaveValue("4000");
  });
});

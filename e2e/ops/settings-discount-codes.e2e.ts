import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { DISCOUNT_CODES, empty, fails, json } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";

// Discount codes (docs/decisions/0108-discount-codes.md), which no board draws.
test.describe("the discount codes", () => {
  const made = (codes: string[]) => json({ codes }, 201);
  const row = (page: Page, code: string) =>
    page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: code, exact: true }) });
  /** Make codes is shut until asked for. */
  const makeForm = async (page: Page) => {
    await page.getByRole("button", { name: "Make codes" }).click();
    return page.getByRole("form", { name: "Make codes" });
  };

  test("heads the page with what every code has come to", async ({ page }) => {
    await open(page, "/discount-codes");
    const figures = page.getByRole("definition");
    await expect(figures).toHaveText(["1", "4", "4", "Rs. 14,000", "Rs. 77,000"]);
    await expect(page.getByRole("term")).toHaveText(["Live codes", "Uses", "Clients", "Discount given", "Revenue"]);
  });

  test("lists each code in a row: its terms, uses, clients, what it gave, what was paid and when last used", async ({
    page,
  }) => {
    await open(page, "/discount-codes");
    await expect(row(page, "WEDDNG25").getByRole("cell")).toHaveText([
      "25% (max Rs. 5,000)",
      "First fit, Service",
      "Fri 31 Dec",
      "3 of 50",
      "3",
      "Rs. 12,000",
      "Rs. 64,000",
      "Sat 18 Sep",
      "Switch off",
    ]);
    await expect(row(page, "TYPO10")).toContainText("Ended Wed 1 Sep");
    await expect(row(page, "TYPO10").getByRole("button", { name: "Delete TYPO10" })).toBeVisible();
    // A code a booking has used is switched off, never deleted.
    await expect(row(page, "WEDDNG25").getByRole("button", { name: "Delete WEDDNG25" })).toHaveCount(0);
  });

  test("folds the codes switched off beneath the table, their figures kept", async ({ page }) => {
    await open(page, "/discount-codes");
    await expect(row(page, "RPLC2K")).toBeHidden();
    await page.getByText("Switched off (1)").click();
    await expect(row(page, "RPLC2K")).toContainText("Rs. 13,000");
    await expect(row(page, "RPLC2K")).toContainText("Fri 10 Sep");
    await expect(row(page, "RPLC2K").getByRole("button")).toHaveCount(0);
  });

  test("sorts the codes by what was paid, and narrows them to what they apply to", async ({ page }) => {
    await open(page, "/discount-codes");
    const rows = page.getByRole("table").first().getByRole("row");
    await page.getByRole("button", { name: "Revenue", exact: true }).click();
    await expect(rows.nth(1)).toContainText("TYPO10");
    await page.getByRole("button", { name: "Revenue", exact: true }).click();
    await expect(rows.nth(1)).toContainText("WEDDNG25");
    await page.getByLabel("Applies to").selectOption("Service");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText("TYPO10");
  });

  test("deletes a code no booking has used, once asked", async ({ page }) => {
    const typo = DISCOUNT_CODES.codes.find((code) => code.code === "TYPO10");
    if (typo === undefined) throw new Error("the fixture has no unused code");
    const left = { ...DISCOUNT_CODES, codes: DISCOUNT_CODES.codes.filter((code) => code.id !== typo.id) };
    let deleted = false;
    await open(page, "/discount-codes", {
      [`POST /api/discount-codes/${typo.id}/delete` as const]: (route) => {
        deleted = true;
        return empty()(route);
      },
      "GET /api/discount-codes": (route) => json(deleted ? left : DISCOUNT_CODES)(route),
    });
    await row(page, "TYPO10").getByRole("button", { name: "Delete TYPO10" }).click();
    await expect(page.getByText("Delete TYPO10? This can't be undone.")).toBeVisible();
    await page.getByRole("button", { name: "Delete permanently" }).click();

    await expect(page.getByRole("status").filter({ hasText: "Deleted." })).toBeVisible();
    await expect(row(page, "TYPO10")).toHaveCount(0);
  });

  test("makes a code ops typed only once they have read what it takes off", async ({ page }) => {
    await open(page, "/discount-codes", { "POST /api/discount-codes": made(["DIWALI"]) });
    const form = await makeForm(page);
    const check = form.getByRole("button", { name: "Review" });
    await expect(check).toBeDisabled();
    await form.getByLabel("Code", { exact: true }).fill("diwali");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Cap, in rupees").fill("1500");
    await form.getByLabel("Service visits").check();
    await check.click();

    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("Code DIWALI");
    await expect(panel).toContainText("10% (max Rs. 1,500) off before GST");
    await expect(panel).toContainText("On Service visits");
    await expect(panel).toContainText("Unlimited uses, once per client");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({
      code: "diwali",
      kind: "percent",
      value: 10,
      cap: 150_000,
      covers: ["service"],
      once_per_client: true,
    });
    await expect(page.getByRole("status").filter({ hasText: "Made: DIWALI" })).toBeVisible();
  });

  test("generates a batch of single-use codes, an amount off each", async ({ page }) => {
    await open(page, "/discount-codes", { "POST /api/discount-codes": made(["A2B3C4D5", "E6F7G8H9"]) });
    const form = await makeForm(page);
    await form.getByLabel("Method").selectOption({ label: "Generate" });
    await form.getByLabel("How many").fill("2");
    await form.getByLabel("Discount").selectOption({ label: "Amount" });
    await form.getByLabel("Rupees").fill("1000");
    await form.getByLabel("First fits, and consultation-and-fit visits").check();
    // A batch's codes are single-use: there is no total to set.
    await expect(form.getByLabel("Total uses")).toHaveCount(0);
    await form.getByRole("button", { name: "Review" }).click();
    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("2 single-use codes");
    await expect(panel).toContainText("Rs. 1,000 off before GST");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Confirm" }).click();
    expect((await request).postDataJSON()).toEqual({
      count: 2,
      kind: "amount",
      value: 100_000,
      covers: ["first_fit"],
      max_uses: 1,
      once_per_client: true,
    });
    await expect(page.getByRole("status")).toHaveText("Made: A2B3C4D5, E6F7G8H9");
  });

  test("says why the API refused a code, of the box it refused", async ({ page }) => {
    await open(page, "/discount-codes", {
      "POST /api/discount-codes": fails(400, "invalid_request", ["code"]),
    });
    const form = await makeForm(page);
    await form.getByLabel("Code", { exact: true }).fill("WELCOME");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Service visits").check();
    await form.getByRole("button", { name: "Review" }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("alert")).toHaveText("4–16 letters or digits, no spaces.");
  });

  // AUDITTEST reached "Make these codes?" before the API refused it.
  test("says beside the box when a typed code cannot be one, before anything is checked", async ({ page }) => {
    await open(page, "/discount-codes");
    const form = await makeForm(page);
    const code = form.getByLabel("Code", { exact: true });
    await code.fill("WEDDING-25");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Service visits").check();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(code).toHaveAccessibleDescription("4–16 letters or digits, no spaces.");
    await expect(form.getByRole("button", { name: "Review" })).toBeDisabled();
    // Ordinary words are codes: I, L and O are allowed in a code ops type.
    await code.fill("WEDDING25");
    await expect(code).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("button", { name: "Review" })).toBeEnabled();
  });

  test("switches a code off only once ops have read what it leaves on record", async ({ page }) => {
    const [wedding] = DISCOUNT_CODES.codes;
    if (wedding === undefined) throw new Error("the fixture has no code");
    const off = `POST /api/discount-codes/${wedding.id}/off` as const;
    await open(page, "/discount-codes", { [off]: empty() });
    await page.getByRole("button", { name: "Switch off WEDDNG25" }).click();
    const panel = page.getByRole("group", { name: "Switch off WEDDNG25?" });
    await expect(panel).toContainText("It can't be used again. 3 bookings keep it.");
    const request = posted(page, `/api/discount-codes/${wedding.id}/off`);
    await panel.getByRole("button", { name: "Switch off" }).click();
    await request;
  });
});

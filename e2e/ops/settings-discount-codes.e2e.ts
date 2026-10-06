import { expect, test } from "../support.ts";
import { DISCOUNT_CODES, empty, fails, json } from "./fixtures.ts";
import { open, posted } from "./settings-fixtures.ts";

// Discount codes (docs/decisions/0108-discount-codes.md), which no board draws.
test.describe("the discount codes", () => {
  const made = (codes: string[]) => json({ codes }, 201);

  test("lists each code with what it takes off, its limits, how far it is used and what it has given", async ({
    page,
  }) => {
    await open(page, "/discount-codes");
    const wedding = page.getByRole("listitem").filter({ hasText: "WEDDNG25" });
    await expect(wedding).toContainText("Takes off 25%, at most Rs. 5,000 before GST");
    await expect(wedding).toContainText("Ends Fri 31 Dec");
    await expect(wedding).toContainText("3 of 50 uses");
    await expect(wedding).toContainText("Rs. 12,000 given");
    await expect(wedding.getByRole("button", { name: "Switch off WEDDNG25" })).toBeVisible();
    const replacements = page.getByRole("listitem").filter({ hasText: "RPLC2K" });
    await expect(replacements).toContainText("Switched off by owner@maneman.in on 10 Sep 2027");
    await expect(replacements.getByRole("button")).toHaveCount(0);
  });

  test("makes a code ops typed only once they have read what it takes off", async ({ page }) => {
    await open(page, "/discount-codes", { "POST /api/discount-codes": made(["DIWALI"]) });
    const form = page.getByRole("form", { name: "Make codes" });
    const check = form.getByRole("button", { name: "Check" });
    await expect(check).toBeDisabled();
    await form.getByLabel("Code", { exact: true }).fill("diwali");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("At most, in rupees").fill("1500");
    await form.getByLabel("Service visits").check();
    await check.click();

    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("The code DIWALI");
    await expect(panel).toContainText("Takes off 10%, at most Rs. 1,500 before GST");
    await expect(panel).toContainText("On Service visits");
    await expect(panel).toContainText("Any number of uses, once per client");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Make them" }).click();
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
    const form = page.getByRole("form", { name: "Make codes" });
    await form.getByLabel("The code").selectOption({ label: "Generate them" });
    await form.getByLabel("How many").fill("2");
    await form.getByLabel("Takes off").selectOption({ label: "An amount" });
    await form.getByLabel("Rupees").fill("1000");
    await form.getByLabel("First fit, and the consultation and fit in one visit").check();
    // A batch's codes are single-use: there is no total to set.
    await expect(form.getByLabel("Total uses")).toHaveCount(0);
    await form.getByRole("button", { name: "Check" }).click();
    const panel = page.getByRole("group", { name: "Make these codes?" });
    await expect(panel).toContainText("2 codes, generated, each used once");
    await expect(panel).toContainText("Takes off Rs. 1,000 before GST");
    const request = posted(page, "/api/discount-codes");
    await panel.getByRole("button", { name: "Make them" }).click();
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
    const form = page.getByRole("form", { name: "Make codes" });
    await form.getByLabel("Code", { exact: true }).fill("WELCOME");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Service visits").check();
    await form.getByRole("button", { name: "Check" }).click();
    await page.getByRole("button", { name: "Make them" }).click();
    await expect(page.getByRole("alert")).toHaveText("A code is 4 to 16 letters and figures, with no spaces or signs.");
  });

  // AUDITTEST reached "Make these codes?" before the API refused it.
  test("says beside the box when a typed code cannot be one, before anything is checked", async ({ page }) => {
    await open(page, "/discount-codes");
    const form = page.getByRole("form", { name: "Make codes" });
    const code = form.getByLabel("Code", { exact: true });
    await code.fill("WEDDING-25");
    await form.getByLabel("Per cent").fill("10");
    await form.getByLabel("Service visits").check();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(code).toHaveAccessibleDescription("A code is 4 to 16 letters and figures, with no spaces or signs.");
    await expect(form.getByRole("button", { name: "Check" })).toBeDisabled();
    // Ordinary words are codes: I, L and O are allowed in a code ops type.
    await code.fill("WEDDING25");
    await expect(code).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("button", { name: "Check" })).toBeEnabled();
  });

  test("switches a code off only once ops have read what it leaves on record", async ({ page }) => {
    const [wedding] = DISCOUNT_CODES.codes;
    if (wedding === undefined) throw new Error("the fixture has no code");
    const off = `POST /api/discount-codes/${wedding.id}/off` as const;
    await open(page, "/discount-codes", { [off]: empty() });
    await page.getByRole("button", { name: "Switch off WEDDNG25" }).click();
    const panel = page.getByRole("group", { name: "Switch off WEDDNG25?" });
    await expect(panel).toContainText("No booking takes it from now on. 3 bookings keep it, as sold.");
    const request = posted(page, `/api/discount-codes/${wedding.id}/off`);
    await panel.getByRole("button", { name: "Switch off" }).click();
    await request;
  });
});

// Stock: what each technician's kit and the central store hold, which is low,
// and the movements ops record (docs/decisions/0087-consumables-and-stock.md).
// Each movement shows what each place holds now beside what it will hold before
// it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, IMRAN, json, STOCK, type Answers } from "./fixtures.ts";

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/stock": json(STOCK), ...extra });
  await page.goto("/stock");
  await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const onHand = (page: Page) => page.getByRole("region", { name: "On hand" });
const recording = (page: Page) => page.getByRole("region", { name: "Record a movement" });

test("is a section of its own beside the technicians, titled by what it is", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Stock · Mane Man operations");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Stock" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("shows what each place holds, a low kit in words, a store below nothing, and a kit whose technician left", async ({
  page,
}) => {
  await open(page);
  const table = onHand(page);
  await expect(table.getByRole("columnheader", { name: "Central store" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Sameer Bhatt (left)" })).toBeVisible();

  const tape = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Tape strips" }) });
  await expect(tape.getByRole("cell").nth(0)).toContainText("120 strip");
  await expect(tape.getByRole("cell").nth(0)).toContainText("Counted Mon 20 Sep");
  await expect(tape.getByRole("cell").nth(1)).toContainText("3 strip");
  await expect(tape.getByRole("cell").nth(1)).toContainText("Low");
  await expect(tape.getByRole("cell").nth(2)).not.toContainText("Low");
  const solvent = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Solvent" }) });
  await expect(solvent.getByRole("cell").nth(0)).toHaveText("-20 ml");
});

test("records a delivery into the store, showing what it holds before and after", async ({ page }) => {
  await open(page, { "POST /api/stock/deliveries": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Consumable").selectOption({ label: "Tape strips" });
  await form.getByLabel("How many").fill("100");
  await form.getByLabel("Note").fill("Supplier's note 4418");
  await form.getByRole("button", { name: "Review" }).click();

  const check = form.getByRole("group", { name: "Review the movement" });
  await expect(check).toBeFocused();
  await expect(check).toContainText("Central store: 120 strip → 220 strip");
  const sent = posted(page, "/api/stock/deliveries");
  await check.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    quantity: 100,
    note: "Supplier's note 4418",
  });
  await expect(form.getByRole("status")).toHaveText("Recorded.");
});

test("a transfer shows both places, and says when the store would hold less than nothing", async ({ page }) => {
  await open(page, { "POST /api/stock/transfers": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Transfer").check();
  await form.getByLabel("Consumable").selectOption({ label: "Solvent" });
  await form.getByLabel("From", { exact: true }).selectOption({ label: "Central store" });
  await form.getByLabel("To", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("How many").fill("10");
  await form.getByRole("button", { name: "Review" }).click();

  const check = form.getByRole("group", { name: "Review the movement" });
  await expect(check).toContainText("Central store: -20 ml → -30 ml");
  await expect(check).toContainText("Imran Qureshi: 150 ml → 160 ml");
  await expect(check).toContainText("Central store would go below zero");
  const sent = posted(page, "/api/stock/transfers");
  await check.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({ consumable_code: "solvent", quantity: 10, from: null, to: IMRAN });
});

test("will not move stock to the place it is in", async ({ page }) => {
  await open(page);
  const form = recording(page);
  await form.getByLabel("Transfer").check();
  await form.getByLabel("From", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("To", { exact: true }).selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("How many").fill("2");
  await expect(form.getByRole("button", { name: "Review" })).toBeDisabled();
});

test("a count shows the figure it finds, and one that agrees says it records only the count", async ({ page }) => {
  await open(page, { "POST /api/stock/counts": json(STOCK) });
  const form = recording(page);
  await form.getByLabel("Count").check();
  await form.getByLabel("Consumable").selectOption({ label: "Tape strips" });
  await form.getByLabel("Where").selectOption({ label: "Imran Qureshi" });
  await form.getByLabel("Counted").fill("3");
  await form.getByRole("button", { name: "Review" }).click();
  await expect(form.getByRole("group", { name: "Review the movement" })).toContainText(
    "Matches what's held. Records the count only.",
  );

  await form.getByRole("button", { name: "Edit" }).click();
  await form.getByLabel("Counted").fill("2");
  await form.getByRole("button", { name: "Review" }).click();
  await expect(form.getByRole("group", { name: "Review the movement" })).toContainText(
    "Imran Qureshi: 3 strip → 2 strip",
  );
  const sent = posted(page, "/api/stock/counts");
  await form.getByRole("button", { name: "Record" }).click();
  expect((await sent).postDataJSON()).toEqual({
    consumable_code: "tape_strips",
    technician_id: IMRAN,
    counted: 2,
    note: null,
  });
});

test("a loss needs its words, and a refusal names what was wrong", async ({ page }) => {
  await open(page, { "POST /api/stock/write-offs": fails(400, "invalid_request", ["technician_id"]) });
  const form = recording(page);
  await form.getByLabel("Loss").check();
  await form.getByLabel("How many").fill("2");
  await expect(form.getByRole("button", { name: "Review" })).toBeDisabled();

  await form.getByLabel("What was lost, and how").fill("Two burst in the heat");
  await form.getByRole("button", { name: "Review" }).click();
  await form.getByRole("button", { name: "Record" }).click();
  await expect(form.getByRole("alert")).toHaveText("Unknown kit. Reload.");
});

test("lists the latest movements, a job's use under the technician who recorded it", async ({ page }) => {
  await open(page);
  const movements = page.getByRole("region", { name: "Latest movements" });
  const used = movements.getByRole("row").filter({ hasText: "Used on a job" });
  await expect(used).toContainText("Tape strips");
  await expect(used).toContainText("-4");
  await expect(used.getByRole("cell").last()).toHaveText("Imran Qureshi");
  await expect(movements.getByRole("row").filter({ hasText: "Delivered" })).toContainText("+100");
});

test("meets WCAG 2.2 AA, with a movement being checked as well", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await recording(page).getByLabel("How many").fill("5");
  await recording(page).getByRole("button", { name: "Review" }).click();
  await expect(recording(page).getByRole("group", { name: "Review the movement" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

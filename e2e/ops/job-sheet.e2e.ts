// Settings, Job sheet: each kind of visit's checklist and the partial reasons,
// which the technician app reads with each job (docs/decisions/0087-consumables-and-stock.md;
// docs/open-points.md, item 28). An item keeps its code through a rename or a
// move, one taken off is kept and can be put back, and the change is shown
// before it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, JOB_SHEET, json, type Answers } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/job-sheet": json(JOB_SHEET), ...extra });
  await page.goto("/settings/job-sheet");
  await expect(page.getByRole("heading", { level: 2, name: "Job sheet" })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const checklist = (page: Page) => page.getByRole("group", { name: "Service visit checklist" });

test("shows a kind's checklist in its order, who set it, and what was taken off", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Job sheet · Settings · Mane Man operations");

  const list = checklist(page);
  await expect(list.getByLabel("Item 1")).toHaveValue("Piece removed");
  await expect(list.getByLabel("Item 3")).toHaveValue("Piece refitted");
  await expect(list).toContainText("Set by ops@maneman.in on 20 Sep 2027");
  await expect(list).toContainText("Adhesive renewed");
  await expect(list.getByRole("button", { name: "Put back: Adhesive renewed" })).toBeVisible();

  await page.getByLabel("Kind of visit").selectOption({ label: "Replacement" });
  const replacement = page.getByRole("group", { name: "Replacement checklist" });
  await expect(replacement.getByLabel("Item 1")).toHaveValue("Old piece removed");
  await expect(replacement).toContainText("Nobody has set this, so the standard list stands.");
});

test("renames, moves, takes off and adds, shows each before it is sent, and keeps every code", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByLabel("Item 2").fill("Scalp cleaned and dried");
  await list.getByRole("button", { name: "Move up: Piece refitted" }).click();
  await list.getByRole("button", { name: "Take off: Piece removed" }).click();
  await list.getByRole("button", { name: "Add an item" }).click();
  await list.getByLabel("Item 3").fill("Photo angles checked");
  await list.getByRole("button", { name: "Save this list" }).click();

  const check = list.getByRole("group", { name: "Check the change" });
  await expect(check).toBeFocused();
  await expect(check).toContainText("Renamed: Scalp cleaned → Scalp cleaned and dried");
  await expect(check).toContainText("Added: Photo angles checked");
  await expect(check).toContainText("Taken off: Piece removed");
  await expect(check).toContainText("The order changes.");

  const sent = posted(page, "/api/job-sheet/checklists/service");
  await check.getByRole("button", { name: "Save it" }).click();
  expect((await sent).postDataJSON()).toEqual({
    items: [
      { code: "piece_refitted", label: "Piece refitted" },
      { code: "scalp_cleaned", label: "Scalp cleaned and dried" },
      { label: "Photo angles checked" },
    ],
  });
  await expect(list.getByRole("status")).toHaveText("Saved. Each phone reads it with the next job it opens.");
});

test("puts an item taken off back on the list, under its own code", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByRole("button", { name: "Put back: Adhesive renewed" }).click();
  await expect(list.getByLabel("Item 4")).toHaveValue("Adhesive renewed");

  await list.getByRole("button", { name: "Save this list" }).click();
  const sent = posted(page, "/api/job-sheet/checklists/service");
  await list.getByRole("button", { name: "Save it" }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    items: [{}, {}, {}, { code: "adhesive_renewed", label: "Adhesive renewed" }],
  });
});

test("will not save an item with no words, nor two alike", async ({ page }) => {
  await open(page);
  const list = checklist(page);
  await list.getByRole("button", { name: "Add an item" }).click();
  await expect(list.getByRole("button", { name: "Save this list" })).toBeDisabled();

  await list.getByLabel("Item 4").fill("piece removed");
  await expect(list.getByRole("button", { name: "Save this list" })).toBeDisabled();
  await list.getByLabel("Item 4").fill("Piece checked");
  await expect(list.getByRole("button", { name: "Save this list" })).toBeEnabled();
});

test("sets the partial reasons the Tasks board reads", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/partial-reasons": json(JOB_SHEET) });
  const reasons = page.getByRole("group", { name: "Partial reasons" });
  await reasons.getByRole("button", { name: "Add a reason" }).click();
  await reasons.getByLabel("Reason 3").fill("Power cut");
  await reasons.getByRole("button", { name: "Save this list" }).click();
  await expect(reasons.getByRole("group", { name: "Check the change" })).toContainText("Added: Power cut");

  const sent = posted(page, "/api/job-sheet/partial-reasons");
  await reasons.getByRole("button", { name: "Save it" }).click();
  expect((await sent).postDataJSON()).toEqual({
    items: [
      { code: "client_stopped_it", label: "Client stopped it partway" },
      { code: "piece_not_ready", label: "The piece was not ready" },
      { label: "Power cut" },
    ],
  });
});

test("meets WCAG 2.2 AA, with a change being checked as well", async ({ page }) => {
  await open(page);
  let results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await checklist(page).getByLabel("Item 1").fill("Piece taken off");
  await checklist(page).getByRole("button", { name: "Save this list" }).click();
  await expect(checklist(page).getByRole("group", { name: "Check the change" })).toBeVisible();
  results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

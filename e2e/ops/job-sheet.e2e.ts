// Settings, Job sheet: each kind of visit's checklist and the partial reasons,
// which the technician app reads with each job (docs/decisions/0087-consumables-and-stock.md;
// docs/open-points.md, item 28). An item keeps its code through a rename or a
// move, one taken off is kept and can be put back, and the change is shown
// before it is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, JOB_SHEET, json, type Answers } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/job-sheet": json(JOB_SHEET), ...extra });
  await page.goto("/settings/job-sheet");
  await expect(page.getByRole("heading", { level: 2, name: settingsCopy.tabs["job-sheet"] })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const checklist = (page: Page) => page.getByRole("group", { name: "Service visit checklist" });

test("shows a kind’s checklist in its order, who set it, and what was taken off", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Job sheet · Settings · Mane Man operations");

  const list = checklist(page);
  await expect(list.getByLabel("Item 1", { exact: true })).toHaveValue("Piece removed");
  await expect(list.getByLabel("Item 1, as the client reads it")).toHaveValue("Hair system removed");
  await expect(list.getByLabel("Item 3", { exact: true })).toHaveValue("Piece refitted");
  await expect(list).toContainText("Set by ops@maneman.in on 20 Sep 2027");
  await expect(list).toContainText("Adhesive renewed");
  await expect(list.getByRole("button", { name: "Restore: Adhesive renewed" })).toBeVisible();

  await page.getByLabel(settingsCopy.jobSheet.kind).selectOption({ label: "Replacement" });
  const replacement = page.getByRole("group", { name: "Replacement checklist" });
  await expect(replacement.getByLabel("Item 1", { exact: true })).toHaveValue("Old piece removed");
  await expect(replacement).toContainText(settingsCopy.jobSheet.committed);
});

test("renames, moves, takes off and adds, shows each before it is sent, and keeps every code", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByLabel("Item 2", { exact: true }).fill("Scalp cleaned and dried");
  await list.getByRole("button", { name: "Move up: Piece refitted" }).click();
  await list.getByRole("button", { name: "Remove: Piece removed" }).click();
  await list.getByRole("button", { name: settingsCopy.jobSheet.add }).click();
  await list.getByLabel("Item 3", { exact: true }).fill("Photo angles checked");
  await list.getByLabel("Item 1, as the client reads it").fill("Hair system refitted");
  await list.getByRole("button", { name: settingsCopy.discountCodes.check }).click();

  const check = list.getByRole("group", { name: settingsCopy.rules.confirm.title });
  await expect(check).toBeFocused();
  await expect(check).toContainText("Renamed: Scalp cleaned → Scalp cleaned and dried");
  await expect(check).toContainText("Piece refitted: the client reads “Hair system refitted”");
  await expect(check).toContainText("Added: Photo angles checked");
  await expect(check).toContainText("Photo angles checked: only the technician sees it");
  await expect(check).toContainText("Removed: Piece removed");
  await expect(check).toContainText(settingsCopy.jobSheet.confirm.moved);

  const sent = posted(page, "/api/job-sheet/checklists/service");
  await check.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
  // The client's words stay their own through the technician's rename, and a new step with none is the technician's.
  expect((await sent).postDataJSON()).toEqual({
    items: [
      { code: "piece_refitted", label: "Piece refitted", client: "Hair system refitted" },
      { code: "scalp_cleaned", label: "Scalp cleaned and dried", client: "Scalp cleaned" },
      { label: "Photo angles checked", client: null },
    ],
  });
  await expect(list.getByRole("status")).toHaveText(settingsCopy.rules.saved);
});

test("puts an item taken off back on the list, under its own code", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByRole("button", { name: "Restore: Adhesive renewed" }).click();
  await expect(list.getByLabel("Item 4", { exact: true })).toHaveValue("Adhesive renewed");

  await list.getByRole("button", { name: settingsCopy.discountCodes.check }).click();
  const sent = posted(page, "/api/job-sheet/checklists/service");
  await list.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    items: [{}, {}, {}, { code: "adhesive_renewed", label: "Adhesive renewed", client: "Adhesive renewed" }],
  });
});

test("will not save an item with no words, nor two alike", async ({ page }) => {
  await open(page);
  const list = checklist(page);
  await list.getByRole("button", { name: settingsCopy.jobSheet.add }).click();
  await expect(list.getByRole("button", { name: settingsCopy.discountCodes.check })).toBeDisabled();

  await list.getByLabel("Item 4", { exact: true }).fill("piece removed");
  await expect(list.getByRole("button", { name: settingsCopy.discountCodes.check })).toBeDisabled();
  await list.getByLabel("Item 4", { exact: true }).fill("Piece checked");
  await expect(list.getByRole("button", { name: settingsCopy.discountCodes.check })).toBeEnabled();
});

test("sets the partial reasons the Tasks board reads", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/partial-reasons": json(JOB_SHEET) });
  const reasons = page.getByRole("group", { name: settingsCopy.jobSheet.reasons });
  await reasons.getByRole("button", { name: settingsCopy.jobSheet.addReason }).click();
  await reasons.getByLabel("Reason 3").fill("Power cut");
  await reasons.getByRole("button", { name: settingsCopy.discountCodes.check }).click();
  await expect(reasons.getByRole("group", { name: settingsCopy.rules.confirm.title })).toContainText(
    "Added: Power cut",
  );

  const sent = posted(page, "/api/job-sheet/partial-reasons");
  await reasons.getByRole("button", { name: settingsCopy.discountCodes.send }).click();
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
  expect(await axeViolations(page)).toEqual([]);

  await checklist(page).getByLabel("Item 1", { exact: true }).fill("Piece taken off");
  await checklist(page).getByRole("button", { name: settingsCopy.discountCodes.check }).click();
  await expect(checklist(page).getByRole("group", { name: settingsCopy.rules.confirm.title })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

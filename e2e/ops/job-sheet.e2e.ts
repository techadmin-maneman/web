// Settings, Job sheet: each kind of visit's checklist and the partial reasons, which the technician app reads with each
// job (docs/decisions/0087-consumables-and-stock.md; docs/open-points.md, item 28). Each item's words change where they
// read, and it is moved, taken off or put back by its own buttons, each change sent at once and whole, every item under
// its own code (docs/decisions/0212-editing-in-place.md).

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, JOB_SHEET, json, type Answers } from "./fixtures.ts";
import { settings as settingsCopy } from "../../apps/ops/src/content/settings.ts";
import { EDITING } from "../../apps/ops/src/content/common.ts";
import { settingsPageNames } from "../../apps/ops/src/content/settings-shell.ts";

const copy = settingsCopy.jobSheet;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/job-sheet": json(JOB_SHEET), ...extra });
  await page.goto("/settings/job-sheet");
  await expect(page.getByRole("heading", { level: 1, name: settingsPageNames["job-sheet"] })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

const checklist = (page: Page) => page.getByRole("region", { name: "Service visit checklist" });

/** The service checklist as it stands, each item under its code with the client's words. */
const SERVICE = [
  { code: "piece_removed", label: "Piece removed", client: "Hair system removed" },
  { code: "scalp_cleaned", label: "Scalp cleaned", client: "Scalp cleaned" },
  { code: "piece_refitted", label: "Piece refitted", client: "Refitted" },
];

test("shows a kind’s checklist in its order, who set it, and what was taken off", async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle("Job sheet · Settings · Mane Man operations");

  const list = checklist(page);
  const first = list.getByRole("button", { name: `${EDITING.change} ${copy.item(1)}` });
  await expect(first).toContainText("Piece removed");
  await expect(first).toContainText("Hair system removed");
  await expect(list.getByRole("button", { name: `${EDITING.change} ${copy.item(3)}` })).toContainText("Piece refitted");
  await expect(list).toContainText("Set by ops@maneman.in on 20 Sep 2027");
  await expect(list).toContainText("Adhesive renewed");
  await expect(list.getByRole("button", { name: copy.putBack("Adhesive renewed") })).toBeVisible();

  await page.getByLabel(copy.kind).selectOption({ label: "Replacement" });
  const replacement = page.getByRole("region", { name: "Replacement checklist" });
  await expect(replacement.getByRole("button", { name: `${EDITING.change} ${copy.item(1)}` })).toContainText(
    "Old piece removed",
  );
  await expect(replacement).toContainText(copy.committed);
});

test("renames an item where it reads, its client's words and every code kept", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByRole("button", { name: `${EDITING.change} ${copy.item(2)}` }).click();
  const label = list.getByRole("textbox", { name: copy.item(2), exact: true });
  await label.fill("Scalp cleaned and dried");
  const sent = posted(page, "/api/job-sheet/checklists/service");
  await label.press("Enter");
  expect((await sent).postDataJSON()).toEqual({
    items: [SERVICE[0], { ...SERVICE[1], label: "Scalp cleaned and dried" }, SERVICE[2]],
  });
});

test("moves an item and takes one off, each sent at once", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  let sent = posted(page, "/api/job-sheet/checklists/service");
  await list.getByRole("button", { name: copy.up("Piece refitted") }).click();
  expect((await sent).postDataJSON()).toEqual({ items: [SERVICE[0], SERVICE[2], SERVICE[1]] });
  await expect(page.getByRole("status").filter({ hasText: copy.saved })).toHaveText(copy.saved);

  sent = posted(page, "/api/job-sheet/checklists/service");
  await list.getByRole("button", { name: copy.remove("Piece removed") }).click();
  expect((await sent).postDataJSON()).toEqual({ items: [SERVICE[1], SERVICE[2]] });
});

test("adds an item, a step with no client's words being the technician's alone", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const list = checklist(page);
  await list.getByRole("button", { name: copy.add }).click();
  const add = list.getByRole("group", { name: copy.add });
  await add.getByLabel(copy.item(4), { exact: true }).fill("Photo angles checked");
  const sent = posted(page, "/api/job-sheet/checklists/service");
  await add.getByRole("button", { name: copy.addButton, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    items: [...SERVICE, { label: "Photo angles checked", client: null }],
  });
});

test("puts an item taken off back on the list, under its own code", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": json(JOB_SHEET) });
  const sent = posted(page, "/api/job-sheet/checklists/service");
  await checklist(page)
    .getByRole("button", { name: copy.putBack("Adhesive renewed") })
    .click();
  expect((await sent).postDataJSON()).toEqual({
    items: [...SERVICE, { code: "adhesive_renewed", label: "Adhesive renewed", client: "Adhesive renewed" }],
  });
});

test("says why an item's words were refused, its box still open", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/checklists/{visit_type}": fails(400, "invalid_request", ["items.0.label"]) });
  const list = checklist(page);
  await list.getByRole("button", { name: `${EDITING.change} ${copy.item(1)}` }).click();
  const label = list.getByRole("textbox", { name: copy.item(1), exact: true });
  await label.fill("Scalp cleaned");
  await label.press("Enter");
  await expect(list.getByRole("alert")).toHaveText(copy.limits.label(JOB_SHEET.max_label));
  await expect(label).toBeVisible();
});

test("sets the partial reasons the Tasks board reads", async ({ page }) => {
  await open(page, { "POST /api/job-sheet/partial-reasons": json(JOB_SHEET) });
  const reasons = page.getByRole("region", { name: copy.reasons });
  await reasons.getByRole("button", { name: copy.addReason }).click();
  const add = reasons.getByRole("group", { name: copy.addReason });
  await add.getByLabel(copy.reason(3)).fill("Power cut");
  const sent = posted(page, "/api/job-sheet/partial-reasons");
  await add.getByRole("button", { name: copy.addButton, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    items: [
      { code: "client_stopped_it", label: "Client stopped it partway" },
      { code: "piece_not_ready", label: "The piece was not ready" },
      { label: "Power cut" },
    ],
  });
});

test("meets WCAG 2.2 AA, with an item being changed as well", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await checklist(page)
    .getByRole("button", { name: `${EDITING.change} ${copy.item(1)}` })
    .click();
  await expect(checklist(page).getByRole("textbox", { name: copy.item(1), exact: true })).toBeFocused();
  expect(await axeViolations(page)).toEqual([]);
});

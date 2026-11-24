// Operations · Counts (docs/decisions/0185-cycle-counts.md): a task opened and counted blind, a hair system held under
// labels counted by scanning them, one waiting for a sign-off signed off with why, and a count started now.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { CLOSE } from "../../apps/ops/src/content/common.ts";
import { counts as copy } from "../../apps/ops/src/content/counts.ts";
import { stockLabels } from "../../apps/ops/src/content/stock-labels.ts";
import { spend } from "../../apps/ops/src/content/spend.ts";

const KIT = {
  id: "ct-1",
  place_id: "kit-1",
  place: "Imran Qureshi",
  item: null,
  count_class: "weekly" as const,
  due_on: "2026-09-21",
  state: "open" as const,
};
const ROOM = { ...KIT, id: "ct-2", place_id: "room-1", place: "Delhi stockroom", state: "sign_off" as const };
const PIECE = { consumable_code: "hs-1", name: "Essential 8×10", labelled: false, unknown_labels: [] };

const BOOK = {
  tasks: [KIT, ROOM],
  places: [{ id: "room-1", name: "Delhi stockroom" }],
  classes: [
    { consumable_code: "solvent", name: "Solvent", count_class: "quarterly" as const, set: false, hair_system: false },
  ],
} satisfies OpsReply<"/api/count-tasks">;

async function open(page: Page, extra: Answers = {}): Promise<void> {
  await answer(page, { "GET /api/count-tasks": json(BOOK), ...extra });
  await page.goto("/counts");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
}

const posted = (page: Page, path: string) =>
  page.waitForRequest((request) => request.url().endsWith(path) && request.method() === "POST");

/** A row's action, by where its count stands, named with the count it opens. */
const opener = (place: string, act: string = copy.act.open) => `${act} · ${copy.heading(place, copy.classes.weekly)}`;

test("says beside its title how many counts are still due, a done one not among them", async ({ page }) => {
  const done = { ...KIT, id: "ct-3", place_id: "room-2", place: "Gurgaon stockroom", state: "done" as const };
  await open(page, { "GET /api/count-tasks": json({ ...BOOK, tasks: [KIT, ROOM, done] }) });
  await expect(page.getByRole("main").getByText(copy.due(2), { exact: true })).toBeVisible();
});

test("opens a task and counts it blind", async ({ page }) => {
  const task = {
    task: KIT,
    items: [{ ...PIECE, state: "to_count" as const }],
  } satisfies OpsReply<"/api/count-tasks/{id}">;
  const done = { task: { ...KIT, state: "done" as const }, items: [{ ...PIECE, state: "settled" as const }] };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "POST /api/count-tasks/{id}/counts": json(done),
  });
  await page.getByRole("button", { name: opener("Imran Qureshi") }).click();
  const panel = page.getByRole("dialog", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await expect(panel).toContainText(copy.countNote);
  await panel.getByLabel(copy.counted(PIECE.name)).fill("2");
  const request = posted(page, "/api/count-tasks/ct-1/counts");
  await panel.getByRole("button", { name: copy.saveCount }).click();
  expect((await request).postDataJSON()).toEqual({ lines: [{ consumable_code: "hs-1", counted: 2 }] });
  await expect(page.getByRole("status").filter({ hasText: copy.countSaid(0) })).toHaveText(copy.countSaid(0));
  expect(await axeViolations(page)).toEqual([]);
});

// A count that differs is counted again in the same panel: the recount waits for its own figure, and asks no reason;
// why it differs is the manager's, at sign-off.
test("counts again what differed, in the same panel, once the recount's figure is typed", async ({ page }) => {
  const task = { task: KIT, items: [{ ...PIECE, state: "to_count" as const }] };
  const again = { task: { ...KIT, state: "recount" as const }, items: [{ ...PIECE, state: "recount" as const }] };
  const waiting = { task: { ...KIT, state: "sign_off" as const }, items: [{ ...PIECE, state: "sign_off" as const }] };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "POST /api/count-tasks/{id}/counts": json(again),
    "POST /api/count-tasks/{id}/recounts": json(waiting),
  });
  await page.getByRole("button", { name: opener("Imran Qureshi") }).click();
  const panel = page.getByRole("dialog", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await panel.getByLabel(copy.counted(PIECE.name)).fill("1");
  await panel.getByRole("button", { name: copy.saveCount }).click();

  await expect(panel).toContainText(copy.recountNote);
  const recount = panel.getByRole("button", { name: copy.saveRecount });
  await expect(panel.getByLabel(copy.counted(PIECE.name))).toHaveValue("");
  await expect(panel.getByLabel(copy.why)).toHaveCount(0);
  await expect(recount).toBeDisabled();
  await panel.getByLabel(copy.counted(PIECE.name)).fill("1");
  await expect(recount).toBeEnabled();
  const request = posted(page, "/api/count-tasks/ct-1/recounts");
  await recount.click();
  expect((await request).postDataJSON()).toEqual({ lines: [{ consumable_code: "hs-1", counted: 1 }] });
  await expect(page.getByRole("status").filter({ hasText: copy.recountSaid(1) })).toHaveText(copy.recountSaid(1));
});

// A weekly count of a place that had since run out offered "Save count" over nothing, and the panel no way out.
test("closes as counted a task whose place holds nothing of it now, and closes the panel", async ({ page }) => {
  const task = { task: KIT, items: [] } satisfies OpsReply<"/api/count-tasks/{id}">;
  const done = { task: { ...KIT, state: "done" as const }, items: [] };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "POST /api/count-tasks/{id}/counts": json(done),
  });
  await page.getByRole("button", { name: opener("Imran Qureshi") }).click();
  const panel = page.getByRole("dialog", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await expect(panel).toContainText(copy.nothingHere);
  const request = posted(page, "/api/count-tasks/ct-1/counts");
  await panel.getByRole("button", { name: copy.closeEmpty }).click();
  expect((await request).postDataJSON()).toEqual({ lines: [] });
  await panel.getByRole("button", { name: CLOSE }).click();
  await expect(panel).toBeHidden();
});

test("signs off a difference with why", async ({ page }) => {
  const task = { task: ROOM, items: [{ ...PIECE, state: "sign_off" as const }] };
  const lines = {
    lines: [
      {
        consumable_code: PIECE.consumable_code,
        name: PIECE.name,
        unit: "piece",
        held: 2,
        counted: 1,
        recounted: 1,
        missing_labels: ["MM-ESS-0000041-R"],
        unknown_labels: [],
      },
    ],
  } satisfies OpsReply<"/api/count-tasks/{id}/differences">;
  const done = { task: { ...ROOM, state: "done" as const }, items: [{ ...PIECE, state: "settled" as const }] };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "GET /api/count-tasks/{id}/differences": json(lines),
    "POST /api/count-tasks/{id}/sign-off": json(done),
  });
  await page.getByRole("button", { name: opener("Delhi stockroom", copy.act.sign_off) }).click();
  const panel = page.getByRole("dialog", { name: copy.heading("Delhi stockroom", copy.classes.weekly) });
  await expect(panel.getByRole("row").filter({ hasText: PIECE.name })).toContainText("2");
  await expect(panel).toContainText(copy.notScanned(["MM-ESS-0000041-R"]));
  await panel.getByLabel(copy.why).fill("One piece not found");
  const request = posted(page, "/api/count-tasks/ct-2/sign-off");
  await panel.getByRole("button", { name: copy.signOff }).click();
  expect((await request).postDataJSON()).toEqual({ note: "One piece not found" });
  await expect(page.getByRole("status").filter({ hasText: copy.signedSaid })).toHaveText(copy.signedSaid);
  expect(await axeViolations(page)).toEqual([]);
});

test("counts a hair system held under labels by scanning them, and flags one not held there", async ({ page }) => {
  const labelled = { ...PIECE, labelled: true };
  const task = { task: KIT, items: [{ ...labelled, state: "to_count" as const }] };
  const flagged = ["MM-ESS-0000099-K"];
  const counted = {
    task: { ...KIT, state: "recount" as const },
    items: [{ ...labelled, state: "recount" as const, unknown_labels: flagged }],
  };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "POST /api/count-tasks/{id}/counts": json(counted),
  });
  await page.getByRole("button", { name: opener("Imran Qureshi") }).click();
  const panel = page.getByRole("dialog", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await expect(panel).toContainText(copy.scanEach(PIECE.name));
  for (const label of ["MM-ESS-0000041-R", flagged[0] ?? ""]) {
    await panel.getByLabel(stockLabels.scan.label, { exact: true }).fill(label);
    await panel.getByRole("button", { name: spend.add }).click();
  }
  await panel.getByLabel(copy.unlabelled(PIECE.name)).fill("1");
  const request = posted(page, "/api/count-tasks/ct-1/counts");
  await panel.getByRole("button", { name: copy.saveCount }).click();
  expect((await request).postDataJSON()).toEqual({
    lines: [{ consumable_code: "hs-1", counted: 3, labels: ["MM-ESS-0000041-R", "MM-ESS-0000099-K"] }],
  });
  await expect(panel).toContainText(copy.notHeld(flagged));
  expect(await axeViolations(page)).toEqual([]);
});

test("starts a count of one item at one place, and opens it", async ({ page }) => {
  const started = {
    task: {
      ...KIT,
      id: "ct-3",
      place_id: "room-1",
      place: "Delhi stockroom",
      item: { consumable_code: "solvent", name: "Solvent" },
    },
    items: [
      { consumable_code: "solvent", name: "Solvent", state: "to_count" as const, labelled: false, unknown_labels: [] },
    ],
  };
  await open(page, {
    "POST /api/count-tasks": json(started, 201),
    "GET /api/count-tasks/{id}": json(started),
  });
  await page.getByRole("button", { name: copy.startTitle }).click();
  const form = page.getByRole("dialog", { name: copy.startTitle });
  await form.getByLabel(copy.place).selectOption("room-1");
  await form.getByLabel(copy.item).selectOption("solvent");
  const request = posted(page, "/api/count-tasks");
  await form.getByRole("button", { name: copy.start }).click();
  expect((await request).postDataJSON()).toEqual({ place_id: "room-1", consumable_code: "solvent" });
  await expect(page.getByRole("dialog", { name: copy.heading("Delhi stockroom", "Solvent") })).toContainText(
    copy.counted("Solvent"),
  );
});

// Each item's class read beside the counts, and changed in a drawer (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md).
test("reads each item's count class beside the counts, and changes one in its drawer", async ({ page }) => {
  const changed = { ...BOOK, classes: [{ ...BOOK.classes[0], count_class: "weekly" as const, set: true }] };
  await open(page, { "POST /api/consumables/{code}/count-class": json(changed) });
  const classes = page.getByRole("region", { name: copy.classesTitle });
  await expect(classes.getByRole("term")).toHaveText(["Solvent"]);
  await expect(classes.getByRole("definition")).toHaveText([copy.classes.quarterly]);
  await classes.getByRole("button", { name: copy.change }).click();
  const drawer = page.getByRole("dialog", { name: copy.classesTitle });
  const request = posted(page, "/api/consumables/solvent/count-class");
  await drawer.getByLabel("Solvent").selectOption("weekly");
  expect((await request).postDataJSON()).toEqual({ count_class: "weekly" });
  await drawer.getByRole("button", { name: CLOSE }).click();
  await expect(classes.getByRole("definition")).toHaveText([copy.classes.weekly]);
});

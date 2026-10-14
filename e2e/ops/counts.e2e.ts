// Operations · Counts (docs/decisions/0185-cycle-counts.md): a task opened and counted blind, a hair system held under
// labels counted by scanning them, one waiting for a sign-off signed off with why, and a count started now.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { counts as copy } from "../../apps/ops/src/content/counts.ts";

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

const opener = (place: string) => `${copy.open} ${copy.heading(place, copy.classes.weekly)}`;

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
  const panel = page.getByRole("region", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await expect(panel).toContainText(copy.countNote);
  await panel.getByLabel(copy.counted(PIECE.name)).fill("2");
  const request = posted(page, "/api/count-tasks/ct-1/counts");
  await panel.getByRole("button", { name: copy.saveCount }).click();
  expect((await request).postDataJSON()).toEqual({ lines: [{ consumable_code: "hs-1", counted: 2 }] });
  await expect(panel.getByRole("status")).toHaveText(copy.countSaid(0));
  expect(await axeViolations(page)).toEqual([]);
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
  await page.getByRole("button", { name: opener("Delhi stockroom") }).click();
  const panel = page.getByRole("region", { name: copy.heading("Delhi stockroom", copy.classes.weekly) });
  await expect(panel.getByRole("row").filter({ hasText: PIECE.name })).toContainText("2");
  await expect(panel).toContainText(copy.notScanned(["MM-ESS-0000041-R"]));
  await panel.getByLabel(copy.why).fill("One piece not found");
  const request = posted(page, "/api/count-tasks/ct-2/sign-off");
  await panel.getByRole("button", { name: copy.signOff }).click();
  expect((await request).postDataJSON()).toEqual({ note: "One piece not found" });
  await expect(panel.getByRole("status")).toHaveText(copy.signedSaid);
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
  const panel = page.getByRole("region", { name: copy.heading("Imran Qureshi", copy.classes.weekly) });
  await expect(panel).toContainText(copy.scanEach(PIECE.name));
  for (const label of ["MM-ESS-0000041-R", flagged[0] ?? ""]) {
    await panel.getByLabel("Label", { exact: true }).fill(label);
    await panel.getByRole("button", { name: "Add" }).click();
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
  const form = page.getByRole("region", { name: copy.startTitle });
  await form.getByLabel(copy.place).selectOption("room-1");
  await form.getByLabel(copy.item).selectOption("solvent");
  const request = posted(page, "/api/count-tasks");
  await form.getByRole("button", { name: copy.start }).click();
  expect((await request).postDataJSON()).toEqual({ place_id: "room-1", consumable_code: "solvent" });
  await expect(page.getByRole("region", { name: copy.heading("Delhi stockroom", "Solvent") })).toContainText(
    copy.counted("Solvent"),
  );
});

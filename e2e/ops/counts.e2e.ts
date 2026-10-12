// Operations · Counts (docs/decisions/0185-cycle-counts.md): a task opened and counted blind, and one waiting for a
// sign-off signed off with why.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type Answers, type OpsReply } from "./fixtures.ts";
import { counts as copy } from "../../apps/ops/src/content/counts.ts";

const KIT = {
  id: "ct-1",
  place_id: "kit-1",
  place: "Imran Qureshi",
  count_class: "weekly" as const,
  due_on: "2026-09-21",
  state: "open" as const,
};
const ROOM = { ...KIT, id: "ct-2", place_id: "room-1", place: "Delhi stockroom", state: "sign_off" as const };
const PIECE = { consumable_code: "hs-1", name: "Essential 8×10" };

const BOOK = {
  tasks: [KIT, ROOM],
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

const opener = (place: string) => `${copy.open} ${copy.heading(place, copy.classes.weekly ?? "")}`;

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
  const panel = page.getByRole("region", { name: copy.heading("Imran Qureshi", copy.classes.weekly ?? "") });
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
    lines: [{ ...PIECE, held: 2, counted: 1, recounted: 1 }],
  } satisfies OpsReply<"/api/count-tasks/{id}/differences">;
  const done = { task: { ...ROOM, state: "done" as const }, items: [{ ...PIECE, state: "settled" as const }] };
  await open(page, {
    "GET /api/count-tasks/{id}": json(task),
    "GET /api/count-tasks/{id}/differences": json(lines),
    "POST /api/count-tasks/{id}/sign-off": json(done),
  });
  await page.getByRole("button", { name: opener("Delhi stockroom") }).click();
  const panel = page.getByRole("region", { name: copy.heading("Delhi stockroom", copy.classes.weekly ?? "") });
  await expect(panel.getByRole("row").filter({ hasText: PIECE.name })).toContainText("2");
  await panel.getByLabel(copy.why).fill("One piece not found");
  const request = posted(page, "/api/count-tasks/ct-2/sign-off");
  await panel.getByRole("button", { name: copy.signOff }).click();
  expect((await request).postDataJSON()).toEqual({ note: "One piece not found" });
  await expect(panel.getByRole("status")).toHaveText(copy.signedSaid);
  expect(await axeViolations(page)).toEqual([]);
});

// Activity as the redesign draws it: each entry a sentence under its day, the client a link, the days beside the
// title, the file of what is shown, and a row's time opening what the log kept.

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json } from "./fixtures.ts";
import { shell } from "../../apps/ops/src/content.ts";
import { activity } from "../../apps/ops/src/content/activity.ts";
import { CONSOLE_CALLS, DONE } from "../../apps/ops/src/content/activity-sentences.ts";

const NOW = new Date("2026-11-24T06:30:00.000Z");

const ENTRIES = [
  {
    id: 3,
    at: "2026-11-24T05:44:00.000Z",
    surface: "ops",
    actor: { kind: "staff", id: "ops.lead@maneman.in", name: null },
    action: "ops.call",
    subject: { kind: "person", id: "p-neha", label: "Neha Kapoor" },
    detail: { method: "POST", route: "/api/clients/:id/notes", path: "/api/clients/p-neha/notes" },
  },
  {
    id: 2,
    at: "2026-11-24T04:00:00.000Z",
    surface: "ops",
    actor: { kind: "staff", id: "growth@maneman.in", name: null },
    action: "spend.add",
    subject: null,
    detail: { spend: "s-1" },
  },
  {
    id: 1,
    at: "2026-11-23T10:00:00.000Z",
    surface: "ops",
    actor: { kind: "staff", id: "ops.lead@maneman.in", name: null },
    action: "ops.call",
    subject: { kind: "appointment", id: "a-rohit", label: "Rohit Malhotra" },
    detail: {
      method: "POST",
      route: "/api/visits/:id/cancel",
      path: "/api/visits/a-rohit/cancel",
      refused: { status: "409", code: "changed" },
    },
  },
] as const;

/** A console sentence as the page writes it: who, then what, the record's name in its place. */
const said = (who: string, phrase: string | undefined, name = "") => `${who} ${(phrase ?? "").replace("{name}", name)}`;

async function open(page: Page) {
  await page.clock.setFixedTime(NOW);
  await answer(page, { "GET /api/activity": json({ entries: ENTRIES, next_cursor: null }) });
  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 1, name: shell.sections.activity })).toBeVisible();
}

test("writes each entry as a sentence under its day, the client a link, the days beside the title", async ({
  page,
}) => {
  await open(page);
  const today = page.getByRole("region", { name: activity.today });
  const note = today.getByRole("listitem").filter({ hasText: "Neha Kapoor" });
  await expect(note).toContainText(
    said("ops.lead@maneman.in", CONSOLE_CALLS["POST /api/clients/{id}/notes"], "Neha Kapoor"),
  );
  await expect(note.getByRole("link", { name: "Neha Kapoor" })).toHaveAttribute("href", /\/clients\/p-neha/);
  await expect(today.getByRole("listitem").nth(1)).toContainText(said("growth@maneman.in", DONE["spend.add"]));

  const yesterday = page.getByRole("region", { name: activity.yesterday });
  await expect(yesterday.getByRole("listitem")).toContainText(activity.columns.refused);
  await expect(yesterday.getByRole("link", { name: "Rohit Malhotra" })).toBeVisible();

  await expect(
    page.getByRole("main").getByText(activity.days("23 Nov", activity.today), { exact: true }),
  ).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("opens what the log kept from a row's time", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: activity.details("11:14 am") }).click();
  const details = page.getByRole("dialog", { name: activity.detailsTitle });
  await expect(details).toContainText("ops.lead@maneman.in");
  await expect(details).toContainText("POST /api/clients/{id}/notes");
  await expect(details).toContainText("p-neha");
  expect(await axeViolations(page)).toEqual([]);
});

test("downloads the entries shown as a file, a row each beneath its columns", async ({ page }) => {
  await open(page);
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: activity.export }).click();
  const file = await saving;
  expect(file.suggestedFilename()).toBe(activity.fileName("2026-11-23", "2026-11-24"));
  const text = await readFile(await file.path(), "utf8");
  expect(text.split("\n")).toHaveLength(ENTRIES.length + 1);
});

test("asks for the pages opened too only when its box is ticked", async ({ page }) => {
  await open(page);
  const asked = page.waitForRequest((request) => request.url().includes("reads=include"));
  await page.getByRole("checkbox", { name: activity.filters.reads }).check();
  await asked;
  await expect(page).toHaveURL(/reads=include/);
});

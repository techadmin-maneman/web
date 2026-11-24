// What the Tasks browser tests share (tasks*.e2e.ts): no alerts waiting, the board opened with its answers, and its
// table, rows and drawers.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { answer, json, TASKS, TASKS_READ_ON, type OpsReply } from "./fixtures.ts";
import { tasks } from "../../apps/ops/src/content.ts";

/** A group as most are: closed only by doing its thing, and snoozed till the morning. */
export const PLAIN = { closable: false, snoozable: true } as const;
/** A group ops may close without doing its thing, with a reason. */
export const CLOSABLE = { closable: true, snoozable: true } as const;
/** A request about a client's own data: closed only by doing it, and never snoozed. */
export const STATUTORY = { closable: false, snoozable: false } as const;

/** No alert open: the Alerts tab is not drawn. */
export const NO_ALERTS: OpsReply<"/api/alerts"> = { count: 0, alerts: [] };

export async function open(
  page: Page,
  body: OpsReply<"/api/tasks"> = TASKS,
  alerts = NO_ALERTS,
  extra: Parameters<typeof answer>[1] = {},
): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(body), "GET /api/alerts": json(alerts), ...extra });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: tasks.title })).toBeVisible();
  // The frame draws the title before the list is read; a spec's own answers come after this.
  await expect(list(page)).toBeVisible();
}

/** The table of tasks, named as the page is. */
export const list = (page: Page) => page.getByRole("region", { name: tasks.title });

/** The tasks' rows, less the table's head. */
export const rows = (page: Page) => list(page).locator("tbody").getByRole("row");

/** A task's row, found by whom it is about or the line that heads it. */
export const row = (page: Page, heading: string) => rows(page).filter({ hasText: heading });

/** A task's drawer, opened from its row, which holds all else done on it. */
export async function detail(page: Page, heading: string) {
  await row(page, heading).getByRole("button").first().click();
  return page.getByRole("dialog", { name: heading });
}

/** The kinds of task listed, each once: the first line of each row's name. */
export async function kindsListed(page: Page): Promise<string[]> {
  const kinds = await rows(page).getByRole("rowheader").locator("button > span:first-child").allTextContents();
  return [...new Set(kinds)].sort();
}

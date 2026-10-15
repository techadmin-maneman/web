// What the Tasks browser tests share (tasks*.e2e.ts): no alerts waiting, the board opened with its answers, and its
// list, rows and group names.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { answer, json, TASKS, TASKS_READ_ON, type OpsReply } from "./fixtures.ts";
import { tasks } from "../../apps/ops/src/content.ts";

/** No alert open: "Needs a hand" draws nothing. */
export const NO_ALERTS: OpsReply<"/api/alerts"> = { count: 0, alerts: [] };

export async function open(page: Page, body: OpsReply<"/api/tasks"> = TASKS, alerts = NO_ALERTS): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(body), "GET /api/alerts": json(alerts) });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: tasks.title })).toBeVisible();
  // The frame draws the title before the list is read; a spec's own answers come after this.
  await expect(list(page)).toBeVisible();
}

/** The list itself; the console's navigation is a list too. */
/** The list of tasks, named by how many are open. */
export const list = (page: Page) => page.getByRole("region", { name: /^\d+ open$/ });

/** A task's row, found by the line that heads it. */
export const row = (page: Page, heading: string) => list(page).getByRole("listitem").filter({ hasText: heading });

/** The groups' names, as each department lists them. */
export const groupNames = (page: Page) => list(page).getByRole("heading", { level: 4 });

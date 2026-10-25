// The console on a phone: it ran the desk's tables off the edge, a figure to a row on Today, and a task squeezed into a
// column a few words wide.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, TASKS, TASKS_READ_ON } from "./fixtures.ts";
import { open as openTechnicians } from "./technicians-fixtures.ts";
import { row } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { today } from "../../apps/ops/src/content/today.ts";

const PHONE = { width: 390, height: 844 };

const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

const [, city, jobs] = opsCopy.technicians.columns;

test("reads a table's rows as cards, each value beside its column's name, the heads still sorting", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openTechnicians(page);
  const faizan = page.getByRole("row").filter({ hasText: "Faizan Ali" });
  await expect(faizan.locator("td").first()).toHaveAttribute("data-label", city);
  expect((await faizan.boundingBox())?.width ?? 0).toBeLessThanOrEqual(PHONE.width);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
  await page.getByRole("button", { name: jobs }).click();
  await expect(page.getByRole("columnheader", { name: jobs })).toHaveAttribute("aria-sort", "ascending");
  expect(await axeViolations(page)).toEqual([]);
});

test("sets Today's figures two to a row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/today");
  const tile = (name: string) => page.locator("main a[href]").filter({ hasText: name }).first();
  await expect(tile(today.tiles.visits)).toBeVisible();
  const first = await tile(today.tiles.visits).boundingBox();
  const second = await tile(today.tiles.unassigned).boundingBox();
  if (first === null || second === null) throw new Error("the tiles are not drawn");
  expect(second.y).toBeCloseTo(first.y, 0);
  expect(second.x).toBeGreaterThan(first.x);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

test("reads a task down: what it is, then whose it is and when it is due beneath", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/tasks");
  const kunal = row(page, "Kunal Mehta");
  const subject = await kunal.getByRole("link", { name: "Kunal Mehta" }).boundingBox();
  const due = await kunal.getByText("3 days overdue").boundingBox();
  if (subject === null || due === null) throw new Error("the task is not drawn");
  expect(due.y).toBeGreaterThan(subject.y + subject.height);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

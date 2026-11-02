// Tasks as one table (ADR 0227): every task the person's access reaches, the longest overdue first, narrowed to their
// own, nobody's or the overdue; each row opens its drawer from anywhere on it, and ends with the step that settles it.

import { expect, test } from "../support.ts";
import { TASKS } from "./fixtures.ts";
import { detail, list, open, row, rows } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const views = opsCopy.tasks.filters.views;
const view = (page: import("@playwright/test").Page, name: string) =>
  page
    .getByRole("radiogroup", { name: opsCopy.tasks.filters.label })
    .getByRole("radio", { name: new RegExp(`^${name}`) });

test("lists every task in one table, the longest overdue first, each with the step that settles it", async ({
  page,
}) => {
  await open(page);
  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).first()).toContainText("Kunal Mehta");
  await expect(rows(page).first()).toContainText(opsCopy.tasks.groups.replacement_order);
  await expect(row(page, "Karan Bose").getByRole("link", { name: "Decide in Referrals · Karan Bose" })).toBeVisible();
});

test("narrows to the person's own, nobody's or the overdue, each counted", async ({ page }) => {
  await open(page);
  await expect(view(page, views.all)).toHaveText(`${views.all}8`);
  await expect(view(page, views.overdue)).toHaveText(`${views.overdue}4`);
  await view(page, views.overdue).click();
  await expect(view(page, views.overdue)).toBeChecked();
  await expect(rows(page)).toHaveCount(4);
  await view(page, views.nobody).click();
  await expect(row(page, "Kunal Mehta")).toHaveCount(0);
  await expect(row(page, "Deepak Rao")).toHaveCount(1);
  await page.getByRole("searchbox", { name: opsCopy.tasks.filters.search }).fill("zzz");
  await expect(view(page, views.nobody)).toHaveText(`${views.nobody}0`);
  await expect(page.getByText(opsCopy.tasks.empty)).toBeVisible();
});

test("writes how long each has left in words, and marks what has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("3 days overdue");
  await expect(row(page, "Rohit Malhotra")).toContainText("2 days left");
  await expect(row(page, "Karan Bose")).toContainText(opsCopy.waiting.today);
  await expect(row(page, "Ashish Gill")).toContainText("1 day left");
});

// On staging, 19 to 29 rows of one group pushed every other group out of sight.
test("shows the fifty longest waits, the rest on asking", async ({ page }) => {
  const [first] = TASKS.groups;
  if (first === undefined) throw new Error("the board’s tasks have no group");
  const [template] = first.tasks;
  if (template === undefined) throw new Error("the board’s first group has no task");
  const many = Array.from({ length: 52 }, (_, index) => ({
    ...template,
    id: `91000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
    person: { id: `22000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`, name: `Client ${String(index)}` },
  }));
  await open(page, { ...TASKS, groups: [{ ...first, count: many.length, tasks: many }] });
  await expect(rows(page)).toHaveCount(50);
  await list(page)
    .getByRole("button", { name: opsCopy.tasks.more(2) })
    .click();
  await expect(rows(page)).toHaveCount(52);
  await list(page).getByRole("button", { name: opsCopy.tasks.fewer }).click();
  await expect(rows(page)).toHaveCount(50);
});

test("names the one fact each group turns on", async ({ page }) => {
  await open(page);
  // The piece's label, the day its order goes in, and the day it is to be replaced.
  await expect(row(page, "Kunal Mehta")).toContainText("MM-STD-4417-K · order by 19 Sep, replace by 17 Oct");
  // The fraud rule, lettered as the referral queue letters it.
  await expect(row(page, "Karan Bose")).toContainText(opsCopy.referrals.queue.signals.monthly_cap);
  await expect(row(page, "Vikram Sethi")).toContainText(opsCopy.tasks.subs.number_change);
  await expect(row(page, "Ashish Gill")).toContainText(opsCopy.tasks.subs.erasure_request);
});

test("opens a task's drawer from anywhere on its row, but its client's name, which opens their page", async ({
  page,
}) => {
  await open(page);
  // The row's name reaches over the row: a click on its owner's cell lands on it.
  await row(page, "Kunal Mehta").getByRole("cell").nth(2).click({ force: true });
  const drawer = page.getByRole("dialog", { name: "Kunal Mehta" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(opsCopy.tasks.groups.replacement_order);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(await detail(page, "Vikram Sethi")).toBeVisible();
  await page.keyboard.press("Escape");
  await row(page, "Kunal Mehta").getByRole("link", { name: "Kunal Mehta", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/22000000-0000-4000-8000-000000000002\/pieces$/);
});

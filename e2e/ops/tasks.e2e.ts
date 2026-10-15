import { expect, test } from "../support.ts";
import { TASKS } from "./fixtures.ts";
import { open, list, row, groupNames } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

// The groups were one 484 px column on a 1440 px screen, money between a call about a move and a job on a day off.
test("stands each group under its department, in the navigation’s order, side by side", async ({ page }) => {
  await open(page);
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([
    opsCopy.tasks.departments.operations,
    opsCopy.tasks.departments.customer_care,
    opsCopy.tasks.departments.finance,
    opsCopy.tasks.departments.growth,
  ]);
  await expect(groupNames(page)).toHaveText([
    opsCopy.tasks.groups.replacement_order,
    opsCopy.tasks.groups.number_change,
    opsCopy.tasks.groups.erasure_request,
    opsCopy.tasks.groups.no_show_decision,
    opsCopy.tasks.groups.referral_review,
  ]);
  await expect(list(page).getByRole("listitem")).toHaveCount(8);

  // Customer Care's two groups share a row of the desk's screen.
  const left = await groupNames(page).nth(1).boundingBox();
  const right = await groupNames(page).nth(2).boundingBox();
  if (left === null || right === null) throw new Error("the two groups are not drawn");
  expect(right.y).toBeCloseTo(left.y, 0);
  expect(right.x).toBeGreaterThan(left.x);
});

test("heads the list with how many have run over, and takes the keyboard to the first", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "4 overdue, go to the first" }).click();
  await expect(row(page, "Kunal Mehta")).toBeFocused();
});

test("writes how long each has left in words, and marks what has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("3 days overdue");
  await expect(row(page, "Rohit Malhotra")).toContainText("2 days left");
  await expect(row(page, "Karan Bose")).toContainText(opsCopy.waiting.today);
  await expect(row(page, "Ashish Gill")).toContainText("1 day left");
});

// On staging, 19 to 29 rows of one group pushed every other group out of sight.
test("shows a group’s five longest waits, the rest on asking, and unfolds it for an overdue task past them", async ({
  page,
}) => {
  const [first] = TASKS.groups;
  if (first === undefined) throw new Error("the board’s tasks have no group");
  const [template] = first.tasks;
  if (template === undefined) throw new Error("the board’s first group has no task");
  const names = ["Amit", "Bharat", "Chirag", "Dev", "Eshan", "Farhan", "Gautam"];
  const tasks = names.map((name, index) => ({
    ...template,
    id: `91000000-0000-4000-8000-00000000010${String(index)}`,
    person: { id: `22000000-0000-4000-8000-00000000010${String(index)}`, name: `${name} Sharma` },
    // The last is the one past its day.
    due: name === "Gautam" ? "2027-09-18T18:30:00.000Z" : "2027-09-24T18:30:00.000Z",
  }));
  await open(page, { ...TASKS, overdue: 1, groups: [{ ...first, count: tasks.length, tasks }] });

  await expect(list(page).getByRole("listitem")).toHaveCount(5);
  await list(page).getByRole("button", { name: "Show 2 more · Replacement order" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(7);
  const fewer = list(page).getByRole("button", { name: "Show fewer · Replacement order" });
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await fewer.click();
  await expect(list(page).getByRole("listitem")).toHaveCount(5);

  await page.getByRole("button", { name: "1 overdue, go to the first" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(7);
  await expect(row(page, "Gautam Sharma")).toBeFocused();
});

test("names the one fact each group turns on", async ({ page }) => {
  await open(page);
  // The piece's label, the day its order goes in, and the day it is to be replaced.
  await expect(row(page, "Kunal Mehta")).toContainText("MM-STD-4417-K · order by 19 Sep 2027, replace by 17 Oct 2027");
  // The fraud rule, lettered as the referral queue letters it.
  await expect(row(page, "Karan Bose")).toContainText(opsCopy.referrals.queue.signals.monthly_cap);
  await expect(row(page, "Vikram Sethi")).toContainText(opsCopy.tasks.subs.number_change);
  await expect(row(page, "Ashish Gill")).toContainText(opsCopy.tasks.subs.erasure_request);
});

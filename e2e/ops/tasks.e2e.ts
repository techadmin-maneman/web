// Tasks (board D2): the queues ops still have to work through, with how long
// each has left. The API is answered from e2e/ops/fixtures.ts, since a local
// database holds no held grant, no no-show and no piece. The clock is fixed to
// the day the fixture's dates are read against, so "2 days" and "Overdue 3"
// mean the same thing on every run.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, fails, json, TASKS, TASKS_READ_ON } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, body: unknown = TASKS): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "/api/tasks": json(body) });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
}

/** The list itself; the console's navigation is a list too. */
const list = (page: Page) => page.getByRole("region", { name: "Tasks" });

/** A task's row, found by the line that heads it. */
const row = (page: Page, heading: string) => list(page).getByRole("listitem").filter({ hasText: heading });

test("groups the queues as the policy orders them, each with its count", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText([
    "Replacement order",
    "Referral review",
    "No-show decision",
    "Number change",
    "Erasure request",
  ]);
  await expect(list(page).getByRole("listitem")).toHaveCount(8);
});

test("heads the list with how many have run over", async ({ page }) => {
  await open(page);
  await expect(page.getByText("4 overdue")).toBeVisible();
});

test("writes the days left as the board writes them, and marks what has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("Overdue 3");
  await expect(row(page, "Rohit Malhotra")).toContainText("2 days");
  await expect(row(page, "Karan Bose")).toContainText("Today");
  await expect(row(page, "Ashish Gill")).toContainText("1 day");
});

test("names the one fact each group turns on", async ({ page }) => {
  await open(page);
  // The piece's label and the day its replacement fell due.
  await expect(row(page, "Kunal Mehta")).toContainText("MM-STD-4417-K · due 17 Sep 2027");
  // The fraud rule, lettered as the referral queue letters it.
  await expect(row(page, "Karan Bose")).toContainText("Monthly cap exceeded");
  await expect(row(page, "Vikram Sethi")).toContainText("Both numbers proven by code");
  await expect(row(page, "Ashish Gill")).toContainText("Asked for in the client's own app");
});

// The board draws no consultation request, so it is left out of the fixture the
// fidelity run reads and given its own answer here
// (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
test("names the day and window a consultation was asked for", async ({ page }) => {
  await open(page, {
    overdue: 0,
    groups: [
      {
        group: "consultation_request",
        count: 1,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000001",
            person: { id: "22000000-0000-4000-8000-000000000007", name: "Neha Kapoor" },
            detail: "2027-09-24 afternoon",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
          },
        ],
      },
    ],
  });
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Consultation request"]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon");
});

test("heads a no-show with its visit and its technician, and never a client", async ({ page }) => {
  await open(page);
  const noShow = row(page, "Imran Qureshi attended");
  await expect(noShow).toContainText("Visit of Sun 19 Sep");
  await expect(noShow.getByRole("link")).toHaveCount(0);
});

test("reaches the client's page from the task that is about them", async ({ page }) => {
  await open(page);
  await row(page, "Rohit Malhotra").getByRole("link", { name: "Rohit Malhotra" }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001");
});

test("says nothing is closed here, since a task leaves when its own row is decided", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Nothing is closed here.")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("says so when no queue holds anything", async ({ page }) => {
  await open(page, { overdue: 0, groups: [] });
  await expect(page.getByText("Nothing is waiting.")).toBeVisible();
  await expect(page.getByText("0 overdue")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "/api/tasks": fails(503, "unavailable") });
  await page.goto("/tasks");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "/api/tasks": json(TASKS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Kunal Mehta")).toBeVisible();
});

test("meets WCAG 2.2 AA with a list, and with none", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await open(page, { overdue: 0, groups: [] });
  const none = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(none.violations.map((violation) => violation.id)).toEqual([]);
});

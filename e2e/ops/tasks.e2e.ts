// Tasks (board D2): the queues ops still have to work through, with how long
// each has left. The API is answered from e2e/ops/fixtures.ts, since a local
// database holds no held grant, no no-show and no piece. The clock is fixed to
// the day the fixture's dates are read against, so "2 days" and "Overdue 3"
// mean the same thing on every run.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, empty, fails, json, TASKS, TASKS_READ_ON, type OpsReply } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function open(page: Page, body: OpsReply<"/api/tasks"> = TASKS): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(body) });
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
    truncated: false,
    staff: [],
    groups: [
      {
        group: "consultation_request",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000001",
            person: { id: "22000000-0000-4000-8000-000000000007", name: "Neha Kapoor" },
            detail: "2027-09-24 afternoon",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Consultation request"]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon");
});

// The next visit (docs/decisions/0086-the-next-visit-is-offered.md): board D2's own At-risk client, a first fit asked
// for on the site and not booked, and a consultation asked for with the first fit to follow.
test("names an At-risk client's weeks since the last visit, a first fit to book, and a fit asked for", async ({
  page,
}) => {
  const body: OpsReply<"/api/tasks"> = {
    overdue: 1,
    truncated: false,
    staff: [],
    groups: [
      {
        group: "consultation_request",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000011",
            person: { id: "22000000-0000-4000-8000-000000000011", name: "Neha Kapoor" },
            detail: "2027-09-24 afternoon first_fit morning",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
      {
        group: "first_fit_to_book",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000012",
            person: { id: "22000000-0000-4000-8000-000000000012", name: "Sanjay Arora" },
            detail: "2027-09-10T04:30:00.000Z afternoon",
            since: "2027-09-16T18:30:00.000Z",
            due: "2027-09-18T18:30:00.000Z",
            owner: null,
          },
        ],
      },
      {
        group: "at_risk_client",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000013",
            person: { id: "22000000-0000-4000-8000-000000000013", name: "Deepak Rao" },
            detail: "2027-07-21T04:30:00.000Z 2027-08-20",
            since: "2027-08-26T18:30:00.000Z",
            due: "2027-08-28T18:30:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  await open(page, body);
  await expect(page.getByRole("heading", { level: 3 })).toHaveText([
    "Consultation request",
    "First fit to book",
    "At-risk client",
  ]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon + first fit, morning");
  await expect(row(page, "Sanjay Arora")).toContainText(
    "Consultation Fri 10 Sep; first fit asked for in the afternoon",
  );
  await expect(row(page, "Deepak Rao")).toContainText("9 weeks since the last visit · due Fri 20 Aug");
  await expect(row(page, "Deepak Rao")).toContainText("Overdue 24");
  // The client books; ops reach them from their page, on their visits.
  await expect(row(page, "Deepak Rao").getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000013/visits",
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

// Two more groups the board does not draw (docs/decisions/0067-alerts-and-silent-failures.md).
test("names a draft invoice's visit, and heads an unfinished erasure with the day, never a client", async ({
  page,
}) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    staff: [],
    groups: [
      {
        group: "draft_invoice",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "96000000-0000-4000-8000-000000000002",
            person: { id: "22000000-0000-4000-8000-000000000008", name: "Sanjay Arora" },
            detail: "8229000000411007",
            since: "2027-09-20T07:30:00.000Z",
            due: "2027-09-22T07:30:00.000Z",
            owner: null,
          },
        ],
      },
      {
        group: "erasure_unfinished",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "22000000-0000-4000-8000-000000000009",
            person: null,
            detail: "8229000000500123",
            since: "2027-09-20T06:00:00.000Z",
            due: "2027-09-22T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Draft invoice", "Erasure left in FSM"]);
  await expect(row(page, "Sanjay Arora")).toContainText("Visit of Mon 20 Sep, still a draft in Books");
  const erased = row(page, "FSM contact 8229000000500123 still holds their details");
  await expect(erased).toContainText("Client erased Mon 20 Sep");
  await expect(erased.getByRole("link")).toHaveCount(0);
});

// A no-show once named its technician alone and led nowhere (OPS-05).
test("names the client of a no-show, and leads to their visits and to the case", async ({ page }) => {
  await open(page);
  const noShow = row(page, "Imran Qureshi attended");
  await expect(noShow.getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000010/visits",
  );
  await noShow.getByRole("link", { name: /^Rule on it in No-shows/ }).click();
  expect(new URL(page.url()).pathname).toBe("/no-shows");
  expect(new URL(page.url()).hash).toBe("#case-66000000-0000-4000-8000-000000000001");
});

test("reaches the client's page from the task that is about them, on the tab it is about", async ({ page }) => {
  await open(page);
  await row(page, "Rohit Malhotra").getByRole("link", { name: "Rohit Malhotra" }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001/pieces");
});

// A referral review once led to the referrer's page, where nothing can be decided (OPS-05).
test("leads each task to the row it is decided on, in the section that decides it", async ({ page }) => {
  await open(page);
  const links = [
    ["Karan Bose", "Decide it in Referrals · Karan Bose", "/referrals#held-92000000-0000-4000-8000-000000000002"],
    [
      "Vikram Sethi",
      "Decide it in Number changes · Vikram Sethi",
      "/number-changes#change-94000000-0000-4000-8000-000000000001",
    ],
    [
      "Ashish Gill",
      "Decide it in Deletion requests · Ashish Gill",
      "/deletion-requests#request-95000000-0000-4000-8000-000000000001",
    ],
  ] as const;
  for (const [heading, name, path] of links) {
    await expect(row(page, heading).getByRole("link", { name, exact: true })).toHaveAttribute("href", path);
  }
  // A replacement is ordered in FSM, so it leads to the client's pieces and nowhere else.
  await expect(row(page, "Kunal Mehta").getByRole("link")).toHaveCount(1);
});

// A grievance was promised an answer in thirty days and waited on no board at all (OPS-08).
test("counts an open grievance down, and leads to it in Grievances", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    staff: [],
    groups: [
      {
        group: "grievance",
        count: 1,
        closable: false,
        tasks: [
          {
            id: "97000000-0000-4000-8000-000000000001",
            person: { id: "22000000-0000-4000-8000-000000000007", name: "Neha Kapoor" },
            detail: null,
            since: "2027-09-14T06:00:00.000Z",
            due: "2027-10-14T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Grievance"]);
  const grievance = row(page, "Neha Kapoor");
  await expect(grievance).toContainText("Raised in the client's own app");
  await expect(grievance).toContainText("22 days");
  await expect(grievance.getByRole("link", { name: /^Answer it in Grievances/ })).toHaveAttribute(
    "href",
    "/grievances#grievance-97000000-0000-4000-8000-000000000001",
  );
});

// The counts were cut at 200 tasks across every group, and said nothing of it (FEO-07).
test("counts a group whole when it lists only its longest waits, and says when it could not count", async ({
  page,
}) => {
  const [first] = TASKS.groups;
  if (first === undefined) throw new Error("the board's tasks have no group");
  await open(page, {
    ...TASKS,
    truncated: true,
    groups: [{ ...first, count: 73 }],
  });
  await expect(page.getByText("73", { exact: true })).toBeVisible();
  await expect(page.getByText("The 2 longest waits of 73.")).toBeVisible();
  await expect(page.getByText("More are waiting than one look reads, so a count here may be short.")).toBeVisible();
});

test("says a task leaves when its own row is decided, and that only a visit left partly done closes here", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByText("A task leaves this list when the thing itself is decided")).toBeVisible();
  // Nothing in the board's own groups closes here.
  await expect(list(page).getByRole("button", { name: /^Close without a follow-up/ })).toHaveCount(0);
});

// Whose each task is (docs/decisions/0092-task-owners.md): board D2's own column, by first name.
test("writes each task's owner in the board's column, by first name, and none where nobody has it", async ({
  page,
}) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("Priya");
  await expect(row(page, "Karan Bose")).toContainText("Anil");
  await expect(row(page, "Deepak Rao")).not.toContainText("Priya");
  await expect(row(page, "Deepak Rao").getByText("Owner: nobody yet")).toBeAttached();
});

test("takes a task, and hands it back, from the row", async ({ page }) => {
  const sent: unknown[] = [];
  await open(page);
  await answer(page, {
    "GET /api/tasks": json(TASKS),
    "PUT /api/tasks/{group}/{id}/owner": async (route) => {
      const body = route.request().postDataJSON() as { owner: string | null };
      sent.push(body);
      await json({ owner: body.owner })(route);
    },
  });
  const deepak = row(page, "Deepak Rao");
  await deepak.getByRole("button", { name: "Take it · Deepak Rao" }).click();
  await expect(deepak).toContainText("Ops");
  await deepak.getByRole("button", { name: "Hand it back · Deepak Rao" }).click();
  await expect(deepak.getByRole("button", { name: "Take it · Deepak Rao" })).toBeVisible();
  expect(sent).toEqual([{ owner: "ops@localhost" }, { owner: null }]);
});

test("gives a task to another member of staff who has signed in, and says so when it cannot", async ({ page }) => {
  await open(page);
  await answer(page, {
    "GET /api/tasks": json(TASKS),
    "PUT /api/tasks/{group}/{id}/owner": json({ owner: "anil@maneman.in" }),
  });
  const deepak = row(page, "Deepak Rao");
  await deepak.getByRole("button", { name: "Give it to… · Deepak Rao" }).click();
  const whom = deepak.getByLabel("Give it to · Deepak Rao");
  await expect(whom).toBeFocused();
  await whom.selectOption("anil@maneman.in");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await deepak.getByRole("button", { name: "Give it", exact: true }).click();
  await expect(deepak).toContainText("Anil");
  await expect(deepak.getByRole("button", { name: "Give it to… · Deepak Rao" })).toBeFocused();

  await answer(page, { "PUT /api/tasks/{group}/{id}/owner": fails(404, "not_found") });
  await row(page, "Sanjay Bhatia").getByRole("button", { name: "Take it · Sanjay Bhatia" }).click();
  await expect(row(page, "Sanjay Bhatia").getByRole("alert")).toContainText("This task has left the list meanwhile");
});

// A visit left partly done may be closed without a follow-up, with why, as the owner ruled (open point 62).
test("closes a visit left partly done with a reason, and it leaves the list", async ({ page }) => {
  const partlyDone: OpsReply<"/api/tasks"> = {
    overdue: 1,
    truncated: false,
    staff: ["ops@localhost"],
    groups: [
      {
        group: "partial_visit",
        count: 2,
        closable: true,
        tasks: [
          {
            id: "98000000-0000-4000-8000-000000000001",
            person: { id: "22000000-0000-4000-8000-000000000014", name: "Manish Tandon" },
            detail: "Client unwell",
            since: "2027-09-18T06:00:00.000Z",
            due: "2027-09-20T06:00:00.000Z",
            owner: null,
          },
          {
            id: "98000000-0000-4000-8000-000000000002",
            person: { id: "22000000-0000-4000-8000-000000000015", name: "Arjun Sood" },
            detail: "The piece was not ready",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  const reasons: unknown[] = [];
  await open(page, partlyDone);
  await answer(page, {
    "POST /api/tasks/{group}/{id}/close": async (route) => {
      reasons.push(route.request().postDataJSON());
      await empty()(route);
    },
  });
  const manish = row(page, "Manish Tandon");
  await manish.getByRole("button", { name: "Close without a follow-up · Manish Tandon" }).click();
  const why = manish.getByLabel("Why no visit is booked to finish it · Manish Tandon");
  await expect(why).toBeFocused();
  const closeIt = manish.getByRole("button", { name: "Close it" });
  await expect(closeIt).toBeDisabled();
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await why.fill("Moving to Pune; wants no more visits.");
  await closeIt.click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("0 overdue")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Tasks" })).toBeFocused();
  expect(reasons).toEqual([{ reason: "Moving to Pune; wants no more visits." }]);
});

test("says so when no queue holds anything", async ({ page }) => {
  await open(page, { overdue: 0, truncated: false, staff: [], groups: [] });
  await expect(page.getByText("Nothing is waiting.")).toBeVisible();
  await expect(page.getByText("0 overdue")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": fails(503, "unavailable") });
  await page.goto("/tasks");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "Kunal Mehta", exact: true })).toBeVisible();
});

test("meets WCAG 2.2 AA with a list, and with none", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await open(page, { overdue: 0, truncated: false, staff: [], groups: [] });
  const none = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(none.violations.map((violation) => violation.id)).toEqual([]);
});

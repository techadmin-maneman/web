import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, empty, fails, json, TASKS, TASKS_READ_ON, type OpsReply } from "./fixtures.ts";
import { NO_ALERTS, open, list, row } from "./tasks-fixtures.ts";

// The counts were cut at 200 tasks across every group, and said nothing of it.
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
  // The group's whole count, and so its department's.
  await expect(list(page).getByText("73", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Longest 2 of 73.")).toBeVisible();
  await expect(page.getByText("Counts may be incomplete.")).toBeVisible();
});

test("offers no close on the board's own groups: only a visit left partly done closes here", async ({ page }) => {
  await open(page);
  // Nothing in the board's own groups closes here.
  await expect(list(page).getByRole("button", { name: /^Close without follow-up/ })).toHaveCount(0);
});

// Whose each task is (docs/decisions/0092-task-owners.md): the design's own column, by first name.
test("writes each task's owner in the board's column, by first name, and none where nobody has it", async ({
  page,
}) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("Priya");
  await expect(row(page, "Karan Bose")).toContainText("Anil");
  await expect(row(page, "Deepak Rao")).not.toContainText("Priya");
  await expect(row(page, "Deepak Rao").getByText("Owner: unassigned")).toBeAttached();
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
  await deepak.getByRole("button", { name: "Take · Deepak Rao" }).click();
  await expect(deepak).toContainText("Ops");
  await deepak.getByRole("button", { name: "Hand back · Deepak Rao" }).click();
  await expect(deepak.getByRole("button", { name: "Take · Deepak Rao" })).toBeVisible();
  expect(sent).toEqual([{ owner: "ops@localhost" }, { owner: null }]);
});

test("gives a task to another member of staff who has signed in, and says so when it cannot", async ({ page }) => {
  await open(page);
  await answer(page, {
    "GET /api/tasks": json(TASKS),
    "PUT /api/tasks/{group}/{id}/owner": json({ owner: "anil@maneman.in" }),
  });
  const deepak = row(page, "Deepak Rao");
  await deepak.getByRole("button", { name: "Assign… · Deepak Rao" }).click();
  const whom = deepak.getByLabel("Assign to · Deepak Rao");
  await expect(whom).toBeFocused();
  await whom.selectOption("anil@maneman.in");
  expect(await axeViolations(page)).toEqual([]);
  await deepak.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(deepak).toContainText("Anil");
  await expect(deepak.getByRole("button", { name: "Assign… · Deepak Rao" })).toBeFocused();

  await answer(page, { "PUT /api/tasks/{group}/{id}/owner": fails(404, "not_found") });
  await row(page, "Sanjay Bhatia").getByRole("button", { name: "Take · Sanjay Bhatia" }).click();
  await expect(row(page, "Sanjay Bhatia").getByRole("alert")).toContainText("Already handled. Reload.");
});

// A visit left partly done may be closed without a follow-up, with why.
test("closes a visit left partly done with a reason, and it leaves the list", async ({ page }) => {
  const partlyDone: OpsReply<"/api/tasks"> = {
    overdue: 1,
    truncated: false,
    low_stock_places: 0,
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
  await manish.getByRole("button", { name: "Close without follow-up · Manish Tandon" }).click();
  const why = manish.getByLabel("Why no follow-up is needed · Manish Tandon");
  await expect(why).toBeFocused();
  const closeIt = manish.getByRole("button", { name: "Close task" });
  await expect(closeIt).toBeDisabled();
  expect(await axeViolations(page)).toEqual([]);

  await why.fill("Moving to Pune; wants no more visits.");
  await closeIt.click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("0 overdue")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Tasks" })).toBeFocused();
  expect(reasons).toEqual([{ reason: "Moving to Pune; wants no more visits." }]);
});

// The call about a move was recorded only from a block ops had to find on the board, and both of the
// board's tasks opened this week's bare board.
test("records a call about a move from its row, and opens each of the board's tasks on its visit", async ({ page }) => {
  const MOVE = "99000000-0000-4000-8000-000000000001";
  const MOVED_VISIT = "77000000-0000-4000-8000-000000000101";
  const ON_LEAVE = "77000000-0000-4000-8000-000000000102";
  const board: OpsReply<"/api/tasks"> = {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    staff: [],
    groups: [
      {
        group: "untold_move",
        count: 1,
        closable: false,
        tasks: [
          {
            id: MOVE,
            person: { id: "22000000-0000-4000-8000-000000000016", name: "Vikram Sethi", mobile: "+919810004418" },
            visit: { id: MOVED_VISIT, starts_at: "2027-09-24T06:30:00.000Z" },
            detail: "2027-09-24T06:30:00.000Z no_consent",
            since: "2027-09-22T04:00:00.000Z",
            due: "2027-09-22T08:00:00.000Z",
            owner: null,
          },
        ],
      },
      {
        group: "leave_conflict",
        count: 1,
        closable: false,
        tasks: [
          {
            id: ON_LEAVE,
            person: { id: "22000000-0000-4000-8000-000000000017", name: "Kunal Mehta" },
            visit: { id: ON_LEAVE, starts_at: "2027-09-30T03:30:00.000Z" },
            detail: "2027-09-30T03:30:00.000Z Imran Qureshi",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  const told: string[] = [];
  await open(page, board);
  await answer(page, {
    "POST /api/dispatch/moves/{id}/told": async (route) => {
      told.push(new URL(route.request().url()).pathname);
      await json({ told: true })(route);
    },
  });

  const vikram = row(page, "Vikram Sethi");
  // The row says why they were not told, so the call starts from the right place.
  await expect(vikram).toContainText(" · not opted in to WhatsApp");
  await expect(vikram.getByRole("link", { name: "Call +91 98100 04418 · Vikram Sethi" })).toHaveAttribute(
    "href",
    "tel:+919810004418",
  );
  await expect(vikram.getByRole("link", { name: "Open in Dispatch · Vikram Sethi" })).toHaveAttribute(
    "href",
    `/dispatch?from=2027-09-24&visit=${MOVED_VISIT}`,
  );
  await expect(row(page, "Kunal Mehta").getByRole("link", { name: "Move in Dispatch · Kunal Mehta" })).toHaveAttribute(
    "href",
    `/dispatch?from=2027-09-30&visit=${ON_LEAVE}`,
  );
  expect(await axeViolations(page)).toEqual([]);

  await vikram.getByRole("button", { name: "Told by phone · Vikram Sethi" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Tasks" })).toBeFocused();
  expect(told).toEqual([`/api/dispatch/moves/${MOVE}/told`]);
});

test("says so when no queue holds anything", async ({ page }) => {
  await open(page, { overdue: 0, truncated: false, low_stock_places: 0, staff: [], groups: [] });
  await expect(page.getByText("All clear.")).toBeVisible();
  await expect(page.getByText("0 overdue")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": fails(503, "unavailable"), "GET /api/alerts": json(NO_ALERTS) });
  await page.goto("/tasks");
  await expect(page.getByRole("alert")).toContainText("Couldn't load this.");

  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "Kunal Mehta", exact: true })).toBeVisible();
});

// ADR 0067, "Alerts on Tasks": what ops were told of in the alert space waits here until it is put right.
test("heads the board with the alerts that need a hand, and sends a failed message again", async ({ page }) => {
  const alerts: OpsReply<"/api/alerts"> = {
    count: 2,
    alerts: [
      {
        id: "97000000-0000-4000-8000-000000000001",
        kind: "message_failed",
        message: "Message 98000000-0000-4000-8000-000000000001 (visit_confirmed) failed after 4 attempts: HTTP 503",
        link: "/clients/22000000-0000-4000-8000-000000000007",
        count: 1,
        told_at: "2027-09-20T06:00:00.000Z",
        last_seen_at: "2027-09-20T06:00:00.000Z",
        send_again: true,
      },
      {
        id: "97000000-0000-4000-8000-000000000002",
        kind: "low_stock",
        message: "Stock is low in the central store: 2 of base tape.",
        link: "/stock",
        count: 3,
        told_at: "2027-09-21T06:00:00.000Z",
        last_seen_at: "2027-09-21T09:00:00.000Z",
        send_again: false,
      },
    ],
  };
  const sentAgain: string[] = [];
  await open(page, TASKS, alerts);
  await answer(page, {
    "POST /api/alerts/{id}/send-again": (route) => {
      sentAgain.push(new URL(route.request().url()).pathname);
      return empty()(route);
    },
  });

  const needsAHand = page.getByRole("region", { name: "Needs a hand" });
  await expect(needsAHand.getByRole("listitem")).toHaveCount(2);
  await expect(needsAHand.getByRole("listitem").first()).toContainText("WhatsApp message failed");
  await expect(needsAHand.getByRole("listitem").nth(1)).toContainText("3 times since Tue 21 Sep");
  await expect(needsAHand.getByRole("link", { name: "Open · Stock low" })).toHaveAttribute("href", "/stock");
  expect(await axeViolations(page)).toEqual([]);

  await needsAHand.getByRole("button", { name: "Send again · WhatsApp message failed" }).click();
  await expect(needsAHand.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Needs a hand" })).toBeFocused();
  expect(sentAgain).toEqual(["/api/alerts/97000000-0000-4000-8000-000000000001/send-again"]);
});

test("meets WCAG 2.2 AA with a list, and with none", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await open(page, { overdue: 0, truncated: false, low_stock_places: 0, staff: [], groups: [] });
  expect(await axeViolations(page)).toEqual([]);
});

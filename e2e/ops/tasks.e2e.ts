// Tasks (board D2): the queues ops still have to work through, with how long
// each has left. The API is answered from e2e/ops/fixtures.ts, since a local
// database holds no held grant, no no-show and no piece. The clock is fixed to
// the day the fixture's dates are read against, so "2 days left" and "3 days
// overdue" mean the same thing on every run.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, empty, fails, json, TASKS, TASKS_READ_ON, type OpsReply } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** No alert open: "Needs a hand" draws nothing. */
const NO_ALERTS: OpsReply<"/api/alerts"> = { count: 0, alerts: [] };

async function open(page: Page, body: OpsReply<"/api/tasks"> = TASKS, alerts = NO_ALERTS): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(body), "GET /api/alerts": json(alerts) });
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
}

/** The list itself; the console's navigation is a list too. */
const list = (page: Page) => page.getByRole("region", { name: "Tasks" });

/** A task's row, found by the line that heads it. */
const row = (page: Page, heading: string) => list(page).getByRole("listitem").filter({ hasText: heading });

/** The groups' names, as each department lists them. */
const groupNames = (page: Page) => list(page).getByRole("heading", { level: 4 });

// The groups were one 484 px column on a 1440 px screen, money between a call about a move and a job on a day off
// (OIA-02).
test("stands each group under its department, in the navigation's order, side by side", async ({ page }) => {
  await open(page);
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([
    "Operations",
    "Customer Care",
    "Finance",
    "Growth",
  ]);
  await expect(groupNames(page)).toHaveText([
    "Replacement order",
    "Number change",
    "Deletion request",
    "No-show decision",
    "Referral review",
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
  await list(page).getByRole("button", { name: "4 overdue, go to the first" }).click();
  await expect(row(page, "Kunal Mehta")).toBeFocused();
});

test("writes how long each has left in words, and marks what has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Kunal Mehta")).toContainText("3 days overdue");
  await expect(row(page, "Rohit Malhotra")).toContainText("2 days left");
  await expect(row(page, "Karan Bose")).toContainText("Due today");
  await expect(row(page, "Ashish Gill")).toContainText("1 day left");
});

// On staging, 19 to 29 rows of one group pushed every other group out of sight (OIA-02).
test("shows a group's five longest waits, the rest on asking, and unfolds it for an overdue task past them", async ({
  page,
}) => {
  const [first] = TASKS.groups;
  if (first === undefined) throw new Error("the board's tasks have no group");
  const [template] = first.tasks;
  if (template === undefined) throw new Error("the board's first group has no task");
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

  await list(page).getByRole("button", { name: "1 overdue, go to the first" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(7);
  await expect(row(page, "Gautam Sharma")).toBeFocused();
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
    low_stock_places: 0,
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
  await expect(groupNames(page)).toHaveText(["Consultation request"]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon");
});

// The next visit (docs/decisions/0086-the-next-visit-is-offered.md): board D2's own At-risk client, a client consulted
// and not fitted, and a consultation asked for with the first fit to follow.
test("names an At-risk client's weeks since the last visit, a first fit to book, and a fit asked for", async ({
  page,
}) => {
  const body: OpsReply<"/api/tasks"> = {
    overdue: 1,
    truncated: false,
    low_stock_places: 0,
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
            id: "22000000-0000-4000-8000-000000000012",
            person: { id: "22000000-0000-4000-8000-000000000012", name: "Sanjay Arora" },
            detail: "2027-09-10T08:00:00.000Z afternoon",
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
  await expect(groupNames(page)).toHaveText(["Consultation request", "First fit to book", "At-risk client"]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon + first fit, morning");
  await expect(row(page, "Sanjay Arora")).toContainText("Consultation Fri 10 Sep, afternoon · not fitted");
  await expect(row(page, "Deepak Rao")).toContainText("9 weeks since the last visit · due Fri 20 Aug");
  await expect(row(page, "Deepak Rao")).toContainText("24 days overdue");
  // The client books; ops reach them from their page, on their visits.
  await expect(row(page, "Deepak Rao").getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000013/visits",
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

// Another group the board does not draw (docs/decisions/0067-alerts-and-silent-failures.md).
test("names a draft invoice's visit", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
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
    ],
  });
  await expect(groupNames(page)).toHaveText(["Draft invoice"]);
  await expect(row(page, "Sanjay Arora")).toContainText("Visit of Mon 20 Sep, still a draft in Books");
});

// A consultation and fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): the request ops
// book by hand while self-serve booking is off, and the payment its client still owes once fitted. No board draws either.
test("names a one visit asked for, and a fitted client's payment still owed, with its product and amount", async ({
  page,
}) => {
  const task = (id: string, name: string, detail: string) => ({
    id,
    person: { id: "22000000-0000-4000-8000-000000000020", name },
    detail,
    since: "2027-09-20T07:30:00.000Z",
    due: "2027-09-22T07:30:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    staff: [],
    groups: [
      {
        group: "consultation_request",
        count: 1,
        closable: false,
        tasks: [task("96000000-0000-4000-8000-000000000020", "Arjun Kapoor", "2027-09-24 morning one_visit")],
      },
      {
        group: "payment_owed",
        count: 3,
        closable: false,
        tasks: [
          task(
            "96000000-0000-4000-8000-000000000021",
            "Nikhil Suri",
            "sent 3500000 https://rzp.io/i/nat Mane Man Natural",
          ),
          task("96000000-0000-4000-8000-000000000022", "Manoj Iyer", "unsent 2500000 - Mane Man Essential"),
          task("96000000-0000-4000-8000-000000000023", "Ravi Menon", "refused 2500000 - Mane Man Essential"),
          task("96000000-0000-4000-8000-000000000024", "Kabir Sethi", "closed 3500000 - Mane Man Natural"),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText(["Consultation request", "Payment owed"]);
  await expect(row(page, "Arjun Kapoor")).toContainText("+ consultation and fit in one visit");
  await expect(row(page, "Nikhil Suri")).toContainText("Mane Man Natural, Rs. 35,000; link sent");
  await expect(row(page, "Manoj Iyer")).toContainText("Mane Man Essential, Rs. 25,000; link not sent yet");
  await expect(row(page, "Ravi Menon")).toContainText("Razorpay refused the link: send one from its dashboard");
  // A link Razorpay made can be copied; one not made yet can only be asked for again; a refused one, neither.
  await expect(row(page, "Nikhil Suri").getByRole("button", { name: "Copy link · Nikhil Suri" })).toBeVisible();
  await expect(row(page, "Manoj Iyer").getByRole("button", { name: /^Copy link/ })).toHaveCount(0);
  await expect(row(page, "Manoj Iyer").getByRole("button", { name: "Send again · Manoj Iyer" })).toBeVisible();
  await expect(row(page, "Ravi Menon").getByRole("button", { name: /^(Copy link|Send again)/ })).toHaveCount(0);
  await expect(row(page, "Kabir Sethi")).toContainText("Mane Man Natural, Rs. 35,000; link closed unpaid");
  await expect(row(page, "Kabir Sethi").getByRole("button", { name: /^(Copy link|Send again)/ })).toHaveCount(0);
  await expect(row(page, "Nikhil Suri").getByRole("link", { name: "Nikhil Suri", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000020/payments",
  );
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  // MON-21: a client who lost the SMS is texted the link again from the row.
  await answer(page, { "POST /api/payment-links/{id}/resend": json({ outcome: "resent" }) });
  await row(page, "Nikhil Suri").getByRole("button", { name: "Send again · Nikhil Suri" }).click();
  await expect(row(page, "Nikhil Suri").getByRole("status")).toHaveText("Texted to them again.");
});

// MON-05, MON-13: money owed back that no refund reached waited nowhere.
test("lists each payment to refund, why, and what is owed back, and leads to the client's payments", async ({
  page,
}) => {
  const task = (id: string, name: string, detail: string) => ({
    id,
    person: { id: "22000000-0000-4000-8000-000000000030", name },
    detail,
    since: "2027-09-20T07:30:00.000Z",
    due: "2027-09-21T07:30:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    staff: [],
    groups: [
      {
        group: "payment_to_refund",
        count: 2,
        closable: false,
        tasks: [
          task("96000000-0000-4000-8000-000000000031", "Nikhil Suri", "let_go 200000 pay_Q1late"),
          task("96000000-0000-4000-8000-000000000032", "Manoj Iyer", "refund_failed 3540000 pay_Q2fail"),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText(["Payment to refund"]);
  await expect(row(page, "Nikhil Suri")).toContainText(
    "Rs. 2,000 owed back on pay_Q1late; Razorpay would not refund it",
  );
  await expect(row(page, "Manoj Iyer")).toContainText("Rs. 35,400 owed back on pay_Q2fail; Razorpay failed the refund");
  await expect(row(page, "Manoj Iyer").getByRole("link", { name: "Manoj Iyer", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000030/payments",
  );
});

// A no-show once named its technician alone and led nowhere (OPS-05).
test("names the client of a no-show, and leads to their visits and to the case", async ({ page }) => {
  await open(page);
  const noShow = row(page, "Imran Qureshi attended");
  await expect(noShow.getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000010/visits",
  );
  await noShow.getByRole("link", { name: /^Rule on it in Payments/ }).click();
  expect(new URL(page.url()).pathname).toBe("/no-shows");
  expect(new URL(page.url()).hash).toBe("#case-66000000-0000-4000-8000-000000000001");
});

// A client's claim for money back once waited on No-shows alone: no row here, no count, no link (OIA-07).
test("names a disputed charge and what it kept, and leads to the dispute in Payments", async ({ page }) => {
  const dispute = (id: string, person: { id: string; name: string } | null, kept: string) => ({
    id,
    person,
    detail: kept,
    since: "2027-09-21T06:00:00.000Z",
    due: "2027-09-23T06:00:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    staff: [],
    groups: [
      {
        group: "no_show_dispute",
        count: 2,
        closable: false,
        tasks: [
          dispute(
            "dd000000-0000-4000-8000-000000000001",
            { id: "22000000-0000-4000-8000-000000000030", name: "Vikram Sethi" },
            "236000",
          ),
          dispute("dd000000-0000-4000-8000-000000000002", null, "0"),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText(["Disputed charge"]);
  const vikram = row(page, "Vikram Sethi");
  await expect(vikram).toContainText("Disputes the charge that kept Rs. 2,360");
  await expect(vikram.getByRole("link", { name: "Vikram Sethi", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000030/visits",
  );
  await expect(
    vikram.getByRole("link", { name: "Rule on it in Payments · Vikram Sethi", exact: true }),
  ).toHaveAttribute("href", "/no-shows#dispute-dd000000-0000-4000-8000-000000000001");
  // A client since erased still has their charge ruled on.
  await expect(row(page, "A client since erased")).toContainText("Disputes the charge that kept a free service visit");
  await expect(
    page.getByRole("navigation", { name: "Console" }).getByRole("link", { name: /^Payments, 2 waiting/ }),
  ).toBeVisible();
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
  // A replacement leads to the client's pieces and nowhere else.
  await expect(row(page, "Kunal Mehta").getByRole("link")).toHaveCount(1);
});

// A grievance was promised an answer in thirty days and waited on no board at all (OPS-08).
test("counts an open grievance down, and leads to it in Grievances", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
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
  await expect(groupNames(page)).toHaveText(["Concern"]);
  const grievance = row(page, "Neha Kapoor");
  await expect(grievance).toContainText("Raised in the client's own app");
  await expect(grievance).toContainText("22 days left");
  await expect(grievance.getByRole("link", { name: /^Answer it in Concerns/ })).toHaveAttribute(
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
  // The group's whole count, and so its department's.
  await expect(list(page).getByText("73", { exact: true })).toHaveCount(2);
  await expect(page.getByText("The 2 longest waits of 73.")).toBeVisible();
  await expect(page.getByText("More are waiting than this page shows, so its counts may be low.")).toBeVisible();
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
  await deepak.getByRole("button", { name: "Assign… · Deepak Rao" }).click();
  const whom = deepak.getByLabel("Assign to · Deepak Rao");
  await expect(whom).toBeFocused();
  await whom.selectOption("anil@maneman.in");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await deepak.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(deepak).toContainText("Anil");
  await expect(deepak.getByRole("button", { name: "Assign… · Deepak Rao" })).toBeFocused();

  await answer(page, { "PUT /api/tasks/{group}/{id}/owner": fails(404, "not_found") });
  await row(page, "Sanjay Bhatia").getByRole("button", { name: "Take it · Sanjay Bhatia" }).click();
  await expect(row(page, "Sanjay Bhatia").getByRole("alert")).toContainText(
    "Someone has dealt with this task already.",
  );
});

// A visit left partly done may be closed without a follow-up, with why, as the owner ruled (open point 62).
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

// OIA-03, BK-21: the call about a move was recorded only from a block ops had to find on the board, and both of the
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
  // BK-20: the row says why he was not told, so the call starts from the right place.
  await expect(vikram).toContainText("; has not agreed to WhatsApp");
  await expect(vikram.getByRole("link", { name: "Call +91 98100 04418 · Vikram Sethi" })).toHaveAttribute(
    "href",
    "tel:+919810004418",
  );
  await expect(vikram.getByRole("link", { name: "Open it in Dispatch · Vikram Sethi" })).toHaveAttribute(
    "href",
    `/dispatch?from=2027-09-24&visit=${MOVED_VISIT}`,
  );
  await expect(
    row(page, "Kunal Mehta").getByRole("link", { name: "Move it in Dispatch · Kunal Mehta" }),
  ).toHaveAttribute("href", `/dispatch?from=2027-09-30&visit=${ON_LEAVE}`);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await vikram.getByRole("button", { name: "Told by phone · Vikram Sethi" }).click();
  await expect(list(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Tasks" })).toBeFocused();
  expect(told).toEqual([`/api/dispatch/moves/${MOVE}/told`]);
});

test("says so when no queue holds anything", async ({ page }) => {
  await open(page, { overdue: 0, truncated: false, low_stock_places: 0, staff: [], groups: [] });
  await expect(page.getByText("Nothing is waiting.")).toBeVisible();
  await expect(page.getByText("0 overdue")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": fails(503, "unavailable"), "GET /api/alerts": json(NO_ALERTS) });
  await page.goto("/tasks");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

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
  await expect(needsAHand.getByRole("listitem").first()).toContainText("A WhatsApp message did not go");
  await expect(needsAHand.getByRole("listitem").nth(1)).toContainText("3 times since Tue 21 Sep");
  await expect(needsAHand.getByRole("link", { name: "Open · Stock is low" })).toHaveAttribute("href", "/stock");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);

  await needsAHand.getByRole("button", { name: "Send again · A WhatsApp message did not go" }).click();
  await expect(needsAHand.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "Needs a hand" })).toBeFocused();
  expect(sentAgain).toEqual(["/api/alerts/97000000-0000-4000-8000-000000000001/send-again"]);
});

test("meets WCAG 2.2 AA with a list, and with none", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await open(page, { overdue: 0, truncated: false, low_stock_places: 0, staff: [], groups: [] });
  const none = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(none.violations.map((violation) => violation.id)).toEqual([]);
});

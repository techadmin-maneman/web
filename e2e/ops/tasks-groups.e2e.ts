import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, TASKS, type OpsReply } from "./fixtures.ts";
import { detail, NO_ALERTS, open, row, groupNames } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

/** What a task turns on, as the board answers it. */
type Facts = OpsReply<"/api/tasks">["groups"][number]["tasks"][number]["facts"];

// The board draws no consultation request, so it is left out of the fixture the
// fidelity run reads and given its own answer here
// (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
test("names the day and window a consultation was asked for", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
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
            facts: {
              group: "consultation_request",
              date: "2027-09-24",
              window: "afternoon",
              one_visit: false,
              discount_code: null,
              first_fit: null,
            },
            detail: "2027-09-24 afternoon",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([opsCopy.tasks.groups.consultation_request]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon");
});

// The next visit (docs/decisions/0086-the-next-visit-is-offered.md): the design's own At-risk client, a client consulted
// and not fitted, and a consultation asked for with the first fit to follow.
test("names an At-risk client’s weeks since the last visit, a first fit to book, and a fit asked for", async ({
  page,
}) => {
  const body: OpsReply<"/api/tasks"> = {
    overdue: 1,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
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
            facts: {
              group: "consultation_request",
              date: "2027-09-24",
              window: "afternoon",
              one_visit: false,
              discount_code: null,
              first_fit: { window: "morning" },
            },
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
            facts: { group: "first_fit_to_book", consulted_at: "2027-09-10T08:00:00.000Z", fit_window: "afternoon" },
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
            facts: { group: "at_risk_client", last_visit_at: "2027-07-21T04:30:00.000Z", due_on: "2027-08-20" },
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
  await expect(groupNames(page)).toHaveText([
    opsCopy.tasks.groups.consultation_request,
    opsCopy.tasks.groups.first_fit_to_book,
    opsCopy.tasks.groups.at_risk_client,
  ]);
  await expect(row(page, "Neha Kapoor")).toContainText("Asked for 24 Sep 2027, afternoon + first fit, morning");
  await expect(row(page, "Sanjay Arora")).toContainText("Consultation Fri 10 Sep, afternoon · not fitted");
  await expect(row(page, "Deepak Rao")).toContainText("9 weeks since last visit · due Fri 20 Aug");
  await expect(row(page, "Deepak Rao")).toContainText("24 days overdue");
  // The client books; ops reach them from their page, on their visits.
  await expect(row(page, "Deepak Rao").getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000013/visits",
  );
  expect(await axeViolations(page)).toEqual([]);
});

// Another group the board does not draw (docs/decisions/0067-alerts-and-silent-failures.md).
test("names a draft invoice’s visit", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
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
            facts: { group: "draft_invoice", invoice_id: "8229000000411007" },
            detail: "8229000000411007",
            since: "2027-09-20T07:30:00.000Z",
            due: "2027-09-22T07:30:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([opsCopy.tasks.groups.draft_invoice]);
  await expect(row(page, "Sanjay Arora")).toContainText("Visit of Mon 20 Sep · draft in Books");
});

// A consultation and fit in one visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): the request ops
// book by hand while self-serve booking is off, and the payment its client still owes once fitted. No board draws either.
test("names a one visit asked for, and a fitted client’s payment still owed, with its product and amount", async ({
  page,
}) => {
  const task = (id: string, name: string, detail: string, facts: Facts) => ({
    id,
    person: { id: "22000000-0000-4000-8000-000000000020", name },
    facts,
    detail,
    since: "2027-09-20T07:30:00.000Z",
    due: "2027-09-22T07:30:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
    staff: [],
    groups: [
      {
        group: "consultation_request",
        count: 1,
        closable: false,
        tasks: [
          task("96000000-0000-4000-8000-000000000020", "Arjun Kapoor", "2027-09-24 morning one_visit", {
            group: "consultation_request",
            date: "2027-09-24",
            window: "morning",
            one_visit: true,
            discount_code: null,
            first_fit: null,
          }),
        ],
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
            {
              group: "payment_owed",
              state: "sent",
              amount: 3500000,
              url: "https://rzp.io/i/nat",
              product: "Mane Man Natural",
              visit_id: "97000000-0000-4000-8000-000000000021",
            },
          ),
          task("96000000-0000-4000-8000-000000000022", "Manoj Iyer", "unsent 2500000 - Mane Man Essential", {
            group: "payment_owed",
            state: "unsent",
            amount: 2500000,
            url: null,
            product: "Mane Man Essential",
            visit_id: "97000000-0000-4000-8000-000000000022",
          }),
          task("96000000-0000-4000-8000-000000000023", "Ravi Menon", "refused 2500000 - Mane Man Essential", {
            group: "payment_owed",
            state: "refused",
            amount: 2500000,
            url: null,
            product: "Mane Man Essential",
            visit_id: "97000000-0000-4000-8000-000000000023",
          }),
          task("96000000-0000-4000-8000-000000000024", "Kabir Sethi", "closed 3500000 - Mane Man Natural", {
            group: "payment_owed",
            state: "closed",
            amount: 3500000,
            url: null,
            product: "Mane Man Natural",
            visit_id: "97000000-0000-4000-8000-000000000024",
          }),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([
    opsCopy.tasks.groups.consultation_request,
    opsCopy.tasks.groups.payment_owed,
  ]);
  await expect(row(page, "Arjun Kapoor")).toContainText(opsCopy.tasks.subs.withOneVisit);
  await expect(row(page, "Nikhil Suri")).toContainText("Mane Man Natural, Rs. 35,000 · link sent");
  await expect(row(page, "Manoj Iyer")).toContainText("Mane Man Essential, Rs. 25,000 · link not sent");
  await expect(row(page, "Ravi Menon")).toContainText("link refused by Razorpay");
  await expect(row(page, "Kabir Sethi")).toContainText("Mane Man Natural, Rs. 35,000 · link closed unpaid");
  await expect(row(page, "Nikhil Suri").getByRole("link", { name: "Nikhil Suri", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000020/payments",
  );
  // A link Razorpay made can be copied; one not made yet can only be asked for again; a refused one, neither.
  const linkButtons = async (heading: string) => {
    const drawer = await detail(page, heading);
    const names = await drawer.getByRole("button", { name: /^(Copy link|Send again)/ }).allTextContents();
    await page.keyboard.press("Escape");
    return names;
  };
  expect(await linkButtons("Manoj Iyer")).toEqual(["Send again · Manoj Iyer"]);
  expect(await linkButtons("Ravi Menon")).toEqual([]);
  expect(await linkButtons("Kabir Sethi")).toEqual([]);

  // A client who lost the SMS is texted the link again from the task's drawer.
  await answer(page, { "POST /api/payment-links/{id}/resend": json({ outcome: "resent" }) });
  const nikhil = await detail(page, "Nikhil Suri");
  await expect(nikhil.getByRole("button", { name: "Copy link · Nikhil Suri" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await nikhil.getByRole("button", { name: "Send again · Nikhil Suri" }).click();
  await expect(nikhil.getByRole("status")).toHaveText(opsCopy.tasks.link.outcomes.resent);
});

// Money owed back that no refund reached waited nowhere.
test("lists each payment to refund, why, and what is owed back, and leads to the client’s payments", async ({
  page,
}) => {
  const task = (id: string, name: string, detail: string, facts: Facts) => ({
    id,
    person: { id: "22000000-0000-4000-8000-000000000030", name },
    facts,
    detail,
    since: "2027-09-20T07:30:00.000Z",
    due: "2027-09-21T07:30:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
    staff: [],
    groups: [
      {
        group: "payment_to_refund",
        count: 2,
        closable: false,
        tasks: [
          task("96000000-0000-4000-8000-000000000031", "Nikhil Suri", "let_go 200000 pay_Q1late", {
            group: "payment_to_refund",
            why: "let_go",
            amount: 200000,
            payment: "pay_Q1late",
          }),
          task("96000000-0000-4000-8000-000000000032", "Manoj Iyer", "refund_failed 3540000 pay_Q2fail", {
            group: "payment_to_refund",
            why: "refund_failed",
            amount: 3540000,
            payment: "pay_Q2fail",
          }),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([opsCopy.tasks.groups.payment_to_refund]);
  await expect(row(page, "Nikhil Suri")).toContainText("Rs. 2,000 to refund on pay_Q1late · refund refused");
  await expect(row(page, "Manoj Iyer")).toContainText("Rs. 35,400 to refund on pay_Q2fail · refund failed");
  await expect(row(page, "Manoj Iyer").getByRole("link", { name: "Manoj Iyer", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000030/payments",
  );
});

// A no-show once named its technician alone and led nowhere.
test("names the client of a no-show, and leads to their visits and to the case", async ({ page }) => {
  await open(page);
  const noShow = row(page, "Imran Qureshi came by");
  await expect(noShow.getByRole("link", { name: "Deepak Rao", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000010/visits",
  );
  await noShow.getByRole("link", { name: /^Decide in Charges/ }).click();
  expect(new URL(page.url()).pathname).toBe("/payments");
  expect(new URL(page.url()).hash).toBe("#case-66000000-0000-4000-8000-000000000001");
});

// A client's claim for money back once waited on No-shows alone: no row here, no count, no link.
test("names a disputed charge and what it kept, and leads to the dispute in Charges", async ({ page }) => {
  const dispute = (id: string, person: { id: string; name: string } | null, kept: number) => ({
    id,
    person,
    facts: { group: "no_show_dispute" as const, kept },
    detail: String(kept),
    since: "2027-09-21T06:00:00.000Z",
    due: "2027-09-23T06:00:00.000Z",
    owner: null,
  });
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
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
            236000,
          ),
          dispute("dd000000-0000-4000-8000-000000000002", null, 0),
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([opsCopy.tasks.groups.no_show_dispute]);
  const vikram = row(page, "Vikram Sethi");
  await expect(vikram).toContainText("Disputes a charge: Rs. 2,360");
  await expect(vikram.getByRole("link", { name: "Vikram Sethi", exact: true })).toHaveAttribute(
    "href",
    "/clients/22000000-0000-4000-8000-000000000030/visits",
  );
  await expect(vikram.getByRole("link", { name: "Decide in Charges · Vikram Sethi", exact: true })).toHaveAttribute(
    "href",
    "/payments#dispute-dd000000-0000-4000-8000-000000000001",
  );
  // A client since erased still has their charge ruled on.
  await expect(row(page, "Erased client")).toContainText("Disputes a charge: a free service visit");
  await expect(
    page
      .getByRole("navigation", { name: opsCopy.shell.title })
      .getByRole("link", { name: opsCopy.shell.waiting(opsCopy.shell.nav.money, 2, false) }),
  ).toBeVisible();
});

test("reaches the client’s page from the task that is about them, on the tab it is about", async ({ page }) => {
  await open(page);
  await row(page, "Rohit Malhotra").getByRole("link", { name: "Rohit Malhotra" }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001/pieces");
});

// A referral review once led to the referrer's page, where nothing can be decided.
test("leads each task to the row it is decided on, in the section that decides it", async ({ page }) => {
  await open(page);
  const links = [
    ["Karan Bose", "Decide in Referrals · Karan Bose", "/referrals#held-92000000-0000-4000-8000-000000000002"],
    [
      "Vikram Sethi",
      "Decide in Number changes · Vikram Sethi",
      "/number-changes#change-94000000-0000-4000-8000-000000000001",
    ],
    [
      "Ashish Gill",
      "Decide in Deletion requests · Ashish Gill",
      "/deletion-requests#request-95000000-0000-4000-8000-000000000001",
    ],
  ] as const;
  for (const [heading, name, path] of links) {
    await expect(row(page, heading).getByRole("link", { name, exact: true })).toHaveAttribute("href", path);
  }
  // A replacement leads to the client's pieces and nowhere else.
  await expect(row(page, "Kunal Mehta").getByRole("link")).toHaveCount(1);
});

// A grievance was promised an answer in thirty days and waited on no board at all.
test("counts an open grievance down, and leads to it in Grievances", async ({ page }) => {
  await open(page, {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
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
            facts: { group: "grievance" },
            detail: null,
            since: "2027-09-14T06:00:00.000Z",
            due: "2027-10-14T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  });
  await expect(groupNames(page)).toHaveText([opsCopy.tasks.groups.grievance]);
  const grievance = row(page, "Neha Kapoor");
  await expect(grievance).toContainText(opsCopy.tasks.subs.grievance);
  await expect(grievance).toContainText("22 days left");
  await expect(grievance.getByRole("link", { name: /^Answer in Concerns/ })).toHaveAttribute(
    "href",
    "/grievances#grievance-97000000-0000-4000-8000-000000000001",
  );
});

// Tasks had no way to narrow it: not to a person's own, a kind, or a client.
test("narrows the board to my own tasks, one kind, or a client found by name", async ({ page }) => {
  await open(page, TASKS, NO_ALERTS, {
    "GET /api/whoami": json({
      signed_in_as: "priya@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      staff: {
        enforced: false,
        listed: true,
        grants: [
          { department: "operations" as const, level: "manage" as const, geography: "national" as const, place: null },
          {
            department: "customer_care" as const,
            level: "manage" as const,
            geography: "national" as const,
            place: null,
          },
          { department: "finance" as const, level: "manage" as const, geography: "national" as const, place: null },
          { department: "growth" as const, level: "manage" as const, geography: "national" as const, place: null },
          { department: "admin" as const, level: "manage" as const, geography: "national" as const, place: null },
        ],
        may_call: ["GET /api/tasks", "GET /api/alerts"],
      },
    }),
  });
  const filters = page.getByRole("search", { name: opsCopy.tasks.filters.label });
  await filters.getByLabel(opsCopy.tasks.filters.mine).check();
  await expect(row(page, "Kunal Mehta")).toBeVisible();
  await expect(row(page, "Rohan Bhalla")).toHaveCount(0);

  await filters.getByLabel(opsCopy.tasks.filters.mine).uncheck();
  await filters.getByLabel(opsCopy.tasks.filters.kind).selectOption({ label: opsCopy.tasks.groups.referral_review });
  await expect(row(page, "Rohan Bhalla")).toBeVisible();
  await expect(row(page, "Kunal Mehta")).toHaveCount(0);

  await filters.getByLabel(opsCopy.tasks.filters.kind).selectOption("");
  await filters.getByLabel(opsCopy.tasks.filters.search).fill("karan");
  await expect(row(page, "Karan Bose")).toBeVisible();
  await expect(row(page, "Rohan Bhalla")).toHaveCount(0);
});

// Giving someone a task told them nothing, and nothing counted what was theirs.
test("counts in the header the tasks given to me that I have not seen, and lists them", async ({ page }) => {
  const grants = ["operations", "customer_care", "finance", "growth", "admin"].map((department) => ({
    department: department as "operations",
    level: "manage" as const,
    geography: "national" as const,
    place: null,
  }));
  await open(page, TASKS, NO_ALERTS, {
    "GET /api/whoami": json({
      signed_in_as: "priya@maneman.in",
      sign_out: "/cdn-cgi/access/logout",
      staff: { enforced: false, listed: true, grants, may_call: ["GET /api/tasks", "GET /api/alerts"] },
    }),
  });
  const mine = page.getByRole("banner").getByRole("button", { name: opsCopy.shell.mine.label(3) });
  await expect(mine).toContainText("3");
  await mine.click();
  await expect(
    page.getByRole("button", { name: opsCopy.shell.mine.item(opsCopy.tasks.groups.replacement_order, "Kunal Mehta") }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("banner").getByRole("button", { name: opsCopy.shell.mine.label(0) })).toBeVisible();
});

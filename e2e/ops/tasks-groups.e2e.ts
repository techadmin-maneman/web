import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./fixtures.ts";
import { open, row, groupNames } from "./tasks-fixtures.ts";

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

// The next visit (docs/decisions/0086-the-next-visit-is-offered.md): the design's own At-risk client, a client consulted
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
  expect(await axeViolations(page)).toEqual([]);
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
  expect(await axeViolations(page)).toEqual([]);

  // A client who lost the SMS is texted the link again from the row.
  await answer(page, { "POST /api/payment-links/{id}/resend": json({ outcome: "resent" }) });
  await row(page, "Nikhil Suri").getByRole("button", { name: "Send again · Nikhil Suri" }).click();
  await expect(row(page, "Nikhil Suri").getByRole("status")).toHaveText("Texted to them again.");
});

// Money owed back that no refund reached waited nowhere.
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

// A no-show once named its technician alone and led nowhere.
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

// A client's claim for money back once waited on No-shows alone: no row here, no count, no link.
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

// A referral review once led to the referrer's page, where nothing can be decided.
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

// A grievance was promised an answer in thirty days and waited on no board at all.
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

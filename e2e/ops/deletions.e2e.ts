// Deletion requests: the accounts clients have asked us to erase, decided here
// (docs/decisions/0049-dpdp.md). The API is answered from e2e/ops/fixtures.ts,
// since only a client's own app makes a request, and nothing in these tests
// erases anybody. The clock is fixed to the day the fixture's dates are read
// against, so the days left of the seven mean the same thing on every run.
//
// An erasure cannot be undone, so what is checked here is mostly that it is
// hard to do by accident: two steps, the consequences written out, and the
// confirmation not usable until ops say they have checked the request.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, DELETION_REQUESTS, fails, json, TASKS_READ_ON, type Call, type OpsReply } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIRST = DELETION_REQUESTS.requests[0];
const DECISION = `/api/deletion-requests/${FIRST?.id ?? ""}/decision` as const;
const DECIDE: Call = `POST ${DECISION}`;
const DELETE = "Delete the account of Rohit Malhotra";

/** The API's refusal while the client still has a visit booked, naming it (src/routes/ops-profile.ts). */
const VISIT_BOOKED = {
  error: { code: "visit_booked", request_id: "test" },
  visits: [
    {
      id: "33000000-0000-4000-8000-000000000002",
      type: "service",
      status: "scheduled",
      window_start: "2027-09-25T03:30:00.000Z",
    },
  ],
  bookings: [],
  payments: [],
  links: [],
} satisfies OpsReply<"/api/deletion-requests/{id}/decision", "post", 409>;
const CHECKED = "I have confirmed this request with the client, on their own number.";

async function open(page: Page, decision = json({ state: "done" })): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS), [DECIDE]: decision });
  await page.goto("/deletion-requests");
  await expect(page.getByRole("heading", { level: 1, name: "Deletion requests" })).toBeVisible();
}

const queue = (page: Page) => page.getByRole("region", { name: "Waiting for a decision" });
const row = (page: Page, name: string) => queue(page).getByRole("listitem").filter({ hasText: name });

/** Opens the confirmation on the first request, which is as far as anything goes without the check. */
async function ask(page: Page): Promise<void> {
  await row(page, "Rohit Malhotra").getByRole("button", { name: DELETE }).click();
  await expect(page.getByRole("group", { name: "Deleting the account of Rohit Malhotra" })).toBeVisible();
}

test("lists every request with the client's number, the day, and the days left of the seven", async ({ page }) => {
  await open(page);
  await expect(queue(page).getByRole("listitem")).toHaveCount(3);
  await expect(row(page, "Rohit Malhotra")).toContainText("+91 98100 04417 · requested 20 Sep 2027");
  await expect(row(page, "Rohit Malhotra")).toContainText("5 days left");
  await expect(row(page, "Ashish Gill")).toContainText("5 days overdue");
  await expect(row(page, "Karan Bose")).toContainText("Due today");
});

test("offers no one-tap delete: the first button only opens the confirmation", async ({ page }) => {
  await open(page);
  let sent = 0;
  page.on("request", (request) => {
    if (request.url().includes("/decision")) sent += 1;
  });
  await ask(page);
  expect(sent).toBe(0);
});

test("says what a deletion destroys and what it keeps, before it can be sent", async ({ page }) => {
  await open(page);
  await ask(page);
  const confirm = page.getByRole("group", { name: "Deleting the account of Rohit Malhotra" });
  await expect(confirm).toContainText("It cannot be undone");
  await expect(confirm.getByRole("heading", { name: "Deleted" })).toBeVisible();
  await expect(confirm).toContainText("Every photograph of them");
  await expect(confirm.getByRole("heading", { name: "Kept" })).toBeVisible();
  await expect(confirm).toContainText("Their invoices in Books, eight years, by law");
});

test("takes focus when it opens, so it is read before anything is sent", async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(page.getByRole("group", { name: "Deleting the account of Rohit Malhotra" })).toBeFocused();
});

test("keeps the delete unusable until ops say they have checked the request", async ({ page }) => {
  await open(page);
  await ask(page);
  const send = page.getByRole("button", { name: "Delete this account" });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox", { name: CHECKED }).check();
  await expect(send).toBeEnabled();
});

test("deletes the account once it is confirmed, and the request leaves the queue", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.getByRole("checkbox", { name: CHECKED }).check();

  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await page.getByRole("button", { name: "Delete this account" }).click();
  // The route wants the field either way, and a deletion carries no reason.
  expect((await sent).postDataJSON()).toEqual({ decision: "delete", reason: null });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("keeps the account when the confirmation is called off", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.getByRole("button", { name: "Keep the account" }).click();
  await expect(row(page, "Rohit Malhotra").getByRole("button", { name: DELETE })).toBeVisible();
  // The keyboard goes back to the button that asked, not to the top of the page (FEO-13).
  await expect(row(page, "Rohit Malhotra").getByRole("button", { name: DELETE })).toBeFocused();
});

test("moves the keyboard to the queue's heading once a request is decided", async ({ page }) => {
  await open(page);
  await ask(page);
  await page.getByRole("checkbox", { name: CHECKED }).check();
  await page.getByRole("button", { name: "Delete this account" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for a decision" })).toBeFocused();
});

// The Tasks board links an erasure request to its row here (OPS-05).
test("brings the request a task named into view, and gives it the keyboard", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS) });
  await page.goto(`/deletion-requests#request-${FIRST?.id ?? ""}`);
  await expect(row(page, "Rohit Malhotra")).toBeFocused();
});

test("rejects a request with a reason, which it will not send without", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await row(page, "Rohit Malhotra").getByRole("button", { name: "Reject the request of Rohit Malhotra" }).click();
  const send = page.getByRole("button", { name: "Reject this request" });
  await expect(send).toBeDisabled();

  await page
    .getByRole("textbox", { name: "Why you are rejecting it" })
    .fill("The number's owner says they did not ask.");
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await send.click();
  expect((await sent).postDataJSON()).toEqual({
    decision: "reject",
    reason: "The number's owner says they did not ask.",
  });
  await expect(page.getByText("Rohit Malhotra")).toBeHidden();
});

test("says so when someone has decided it already, and the client is not erased", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await ask(page);
  await page.getByRole("checkbox", { name: CHECKED }).check();
  await page.getByRole("button", { name: "Delete this account" }).click();
  await expect(page.getByRole("alert")).toContainText("Someone has decided this one already.");
  await expect(row(page, "Rohit Malhotra")).toBeVisible();
});

test("says what to settle first when the client still has a visit booked, and erases nothing", async ({ page }) => {
  await open(page, json(VISIT_BOOKED, 409));
  await ask(page);
  await page.getByRole("checkbox", { name: CHECKED }).check();
  await page.getByRole("button", { name: "Delete this account" }).click();
  await expect(page.getByRole("alert")).toContainText("They still have a visit booked, so nothing was erased.");
  await expect(page.getByRole("alert").getByRole("link", { name: "Open their visits" })).toHaveAttribute(
    "href",
    `/clients/${FIRST?.person_id ?? ""}/visits`,
  );
  await expect(row(page, "Rohit Malhotra")).toBeVisible();
});

test("says so when nothing is waiting", async ({ page }) => {
  await answer(page, { "GET /api/deletion-requests": json({ requests: [] }) });
  await page.goto("/deletion-requests");
  await expect(page.getByText("No deletion request is waiting.")).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/deletion-requests": fails(503, "unavailable") });
  await page.goto("/deletion-requests");
  await expect(page.getByRole("alert")).toContainText("We could not load this.");

  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS) });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue, and with the confirmation open", async ({ page }) => {
  await open(page);
  const full = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(full.violations.map((violation) => violation.id)).toEqual([]);

  await ask(page);
  const asking = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(asking.violations.map((violation) => violation.id)).toEqual([]);
});

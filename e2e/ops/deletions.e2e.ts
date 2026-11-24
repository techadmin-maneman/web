// Deletion requests: the accounts clients have asked us to erase, decided here
// (docs/decisions/0049-dpdp.md). The API is answered from e2e/ops/fixtures.ts,
// since only a client's own app makes a request, and nothing in these tests
// erases anybody. The clock is fixed to the day the fixture's dates are read
// against, so the days left of the 30 mean the same thing on every run.
//
// An erasure cannot be undone, so what is checked here is mostly that it is
// hard to do by accident: two steps, the consequences written out, and the
// confirmation not usable until ops say they have checked the request.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, DELETION_REQUESTS, fails, json, TASKS_READ_ON, type Call, type OpsReply } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { DISMISS, states } from "../../packages/ui/words.ts";

/** Someone who may read the deletion requests but not decide them: every call but the decision. */
const READ_ONLY = json({
  signed_in_as: "care@localhost",
  sign_out: null,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "view", geography: "national", place: null }],
    may_call: Object.keys(ROUTE_NEEDS).filter((call) => call !== "POST /api/deletion-requests/{id}/decision"),
  },
  cities: ["Gurgaon"],
  every_city: true,
} satisfies OpsReply<"/api/whoami">);

const FIRST = DELETION_REQUESTS.requests[0];
const DECISION = `/api/deletion-requests/${FIRST?.id ?? ""}/decision` as const;
const DECIDE: Call = `POST ${DECISION}`;
const DELETE = opsCopy.deletions.queue.deleteLabel("Rohit Malhotra");
const CONFIRMING = opsCopy.deletions.queue.confirmLabel("Rohit Malhotra");
const ERASE = opsCopy.deletions.queue.confirm("Rohit Malhotra");

/** The API's refusal while the client still has a visit booked, naming it (src/routes/ops/profile.ts). */
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
const CHECKED = opsCopy.deletions.queue.checked;
const CHAT_DELETED = opsCopy.deletions.queue.chatDeleted;

async function open(page: Page, decision = json({ state: "done" })): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS), [DECIDE]: decision });
  await page.goto("/deletion-requests");
  await expect(page.getByRole("heading", { level: 1, name: opsCopy.deletions.title })).toBeVisible();
}

const words = opsCopy.deletions.queue;
// The list's panel is titled as its page, its heading read rather than shown again.
const queue = (page: Page) => page.getByRole("region", { name: opsCopy.deletions.title });
const row = (page: Page, name: string) => queue(page).getByRole("row").filter({ hasText: name });
const drawer = (page: Page, name = "Rohit Malhotra") => page.getByRole("dialog", { name });

/** Opens a request from the client's name, in a drawer by their name. */
async function opened(page: Page, name: string) {
  await queue(page)
    .getByRole("button", { name: words.openLabel(name) })
    .click();
  return drawer(page, name);
}

/** Opens the confirmation on the first request from its row, as far as anything goes without the check. */
async function ask(page: Page): Promise<void> {
  await row(page, "Rohit Malhotra").getByRole("button", { name: DELETE }).click();
  await expect(drawer(page).getByRole("group", { name: CONFIRMING })).toBeVisible();
}

test("lists every request a row: when asked, the days left of the 30, what to settle; how many beside the title", async ({
  page,
}) => {
  await open(page);
  await expect(queue(page).getByRole("rowheader")).toHaveCount(3);
  await expect(row(page, "Rohit Malhotra")).toContainText("5 days left");
  await expect(row(page, "Ashish Gill")).toContainText("5 days overdue");
  await expect(row(page, "Karan Bose")).toContainText(opsCopy.waiting.today);
  await expect(row(page, "Ashish Gill")).toContainText(words.settle.visit_booked);
  await expect(row(page, "Karan Bose")).toContainText(words.settle.none);
  await expect(page.getByRole("main").getByText(words.toDecide(3), { exact: true })).toBeVisible();

  await expect(await opened(page, "Rohit Malhotra")).toContainText("+91 98100 04417 · requested 28 Aug 2027");
});

test("says when a client booked a visit after asking, so ops ask before erasing", async ({ page }) => {
  await open(page);
  await expect(await opened(page, "Ashish Gill")).toContainText(words.bookedSince("24 Sep 2027"));
});

test("says what must be settled before a client can be erased, with the way to their tab", async ({ page }) => {
  await open(page);
  const ashish = await opened(page, "Ashish Gill");
  await expect(ashish).toContainText(words.errors.visit_booked);
  await expect(ashish.getByRole("link", { name: words.settleOn.visits })).toBeVisible();
});

test("offers no one-tap erase: the row's Erase only opens the confirmation", async ({ page }) => {
  await open(page);
  let sent = 0;
  page.on("request", (request) => {
    if (request.url().includes("/decision")) sent += 1;
  });
  await ask(page);
  expect(sent).toBe(0);
});

test("says what an erasure destroys and what it keeps, before it can be sent", async ({ page }) => {
  await open(page);
  await ask(page);
  const confirm = drawer(page).getByRole("group", { name: CONFIRMING });
  await expect(confirm).toContainText("It can’t be undone");
  await expect(confirm.getByRole("heading", { name: words.deleted.title })).toBeVisible();
  await expect(confirm).toContainText("Every photo: visits and try-ons");
  await expect(confirm.getByRole("heading", { name: words.kept.title })).toBeVisible();
  await expect(confirm).toContainText("Invoices in Books, for 8 years, by law");
});

test("takes focus when it opens, so it is read before anything is sent", async ({ page }) => {
  await open(page);
  await ask(page);
  await expect(drawer(page).getByRole("group", { name: CONFIRMING })).toBeFocused();
});

test("keeps the erase unusable until ops say they have checked the request", async ({ page }) => {
  await open(page);
  await ask(page);
  const send = drawer(page).getByRole("button", { name: ERASE });
  await expect(send).toBeDisabled();
  await drawer(page).getByRole("checkbox", { name: CHECKED }).check();
  // The number is blanked by the erasure, so the chat on the phone goes first.
  await expect(send).toBeDisabled();
  await drawer(page).getByRole("checkbox", { name: CHAT_DELETED }).check();
  await expect(send).toBeEnabled();
});

/** Ticks both checks and sends the erasure. */
async function erase(page: Page): Promise<void> {
  await drawer(page).getByRole("checkbox", { name: CHECKED }).check();
  await drawer(page).getByRole("checkbox", { name: CHAT_DELETED }).check();
  await drawer(page).getByRole("button", { name: ERASE }).click();
}

test("erases the client once it is confirmed, and the request leaves the list", async ({ page }) => {
  await open(page);
  await ask(page);
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await erase(page);
  // The route wants the field either way, and an erasure carries no reason.
  expect((await sent).postDataJSON()).toEqual({ decision: "delete", reason: null });
  await expect(row(page, "Rohit Malhotra")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: words.done.delete })).toBeVisible();
});

test("keeps the account when the confirmation is called off", async ({ page }) => {
  await open(page);
  await ask(page);
  await drawer(page).getByRole("button", { name: DISMISS.cancel }).click();
  // The keyboard goes to the drawer's Erase, where the confirmation stood, not to the top of the drawer.
  await expect(drawer(page).getByRole("button", { name: DELETE })).toBeFocused();
});

test("moves the keyboard to the list’s heading once a request is decided", async ({ page }) => {
  await open(page);
  await ask(page);
  await erase(page);
  await expect(page.getByRole("heading", { level: 2, name: opsCopy.deletions.title })).toBeFocused();
});

// The Tasks board links an erasure request to its row here.
test("opens the request a task named", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS) });
  await page.goto(`/deletion-requests#request-${FIRST?.id ?? ""}`);
  await expect(drawer(page)).toBeVisible();
});

test("keeps the account with a reason, which it will not send without", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  await row(page, "Rohit Malhotra")
    .getByRole("button", { name: words.rejectLabel("Rohit Malhotra") })
    .click();
  const reason = drawer(page).getByRole("textbox", { name: words.reason.label });
  await expect(reason).toBeFocused();
  const send = drawer(page).getByRole("button", { name: words.reason.confirm });
  await expect(send).toBeDisabled();

  await reason.fill("The number’s owner says they did not ask.");
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await send.click();
  expect((await sent).postDataJSON()).toEqual({
    decision: "reject",
    reason: "The number’s owner says they did not ask.",
  });
  await expect(row(page, "Rohit Malhotra")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: words.done.reject })).toBeVisible();
});

// Ops were told to reload; the page now reads itself again in place and says why.
test("says so when someone has decided it already, reads the list again, and the client is not erased", async ({
  page,
}) => {
  await open(page, fails(404, "not_found"));
  await ask(page);
  const reread = page.waitForRequest(
    (request) => request.url().endsWith("/api/deletion-requests") && request.method() === "GET",
  );
  await erase(page);
  await reread;
  await expect(page.getByText("Already decided. Here’s the latest.")).toBeVisible();
  await expect(row(page, "Rohit Malhotra")).toBeVisible();
});

test("says what to settle first when the client still has a visit booked, and erases nothing", async ({ page }) => {
  await open(page, json(VISIT_BOOKED, 409));
  await ask(page);
  await erase(page);
  const refusal = drawer(page).getByRole("alert");
  await expect(refusal).toContainText("They have a visit booked.");
  await expect(refusal.getByRole("link", { name: words.settleOn.visits })).toHaveAttribute(
    "href",
    `/clients/${FIRST?.person_id ?? ""}/visits`,
  );
  await expect(row(page, "Rohit Malhotra")).toBeVisible();
});

test("says so when nothing is waiting, and nothing beside the title", async ({ page }) => {
  await answer(page, { "GET /api/deletion-requests": json({ requests: [] }) });
  await page.goto("/deletion-requests");
  await expect(page.getByText(words.empty)).toBeVisible();
  await expect(page.getByRole("main").getByText(words.toDecide(0), { exact: true })).toHaveCount(0);
});

test("offers no Erase or Keep to someone who may only read the requests", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS), "GET /api/whoami": READ_ONLY });
  await page.goto("/deletion-requests");
  await expect(row(page, "Rohit Malhotra")).toBeVisible();
  await expect(queue(page).getByRole("button", { name: DELETE })).toHaveCount(0);
  await expect(queue(page).getByRole("button", { name: words.rejectLabel("Rohit Malhotra") })).toHaveCount(0);
  const rohit = await opened(page, "Rohit Malhotra");
  await expect(rohit.getByRole("button", { name: DELETE })).toHaveCount(0);
});

test("holds the list's room while it is read", async ({ page }) => {
  await answer(page, {
    "GET /api/deletion-requests": async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      return json(DELETION_REQUESTS)(route);
    },
  });
  await page.goto("/deletion-requests");
  await expect(page.getByRole("main").getByText(states.loading)).toBeVisible();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/deletion-requests": fails(503, "unavailable") });
  await page.goto("/deletion-requests");
  await expect(page.getByRole("alert")).toContainText(opsCopy.states.failed);

  await answer(page, { "GET /api/deletion-requests": json(DELETION_REQUESTS) });
  await page.getByRole("button", { name: opsCopy.states.retry }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with the confirmation open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await ask(page);
  expect(await axeViolations(page)).toEqual([]);
});

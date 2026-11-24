// Grievances: the concerns clients have raised about their data, answered and
// closed here (docs/decisions/0049-dpdp.md). The API is answered from
// e2e/ops/fixtures.ts, since only a client's own app raises one. The clock is
// fixed to the day the fixture's dates are read against, so the days left of
// the answer time mean the same thing on every run.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, GRIEVANCES, json, TASKS_READ_ON, type Call, type OpsReply } from "./fixtures.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { states } from "../../packages/ui/words.ts";
/** Someone who may read the concerns but not decide them: every call but the decision. */
const READ_ONLY = json({
  signed_in_as: "care@localhost",
  sign_out: null,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "view", geography: "national", place: null }],
    may_call: Object.keys(ROUTE_NEEDS).filter((call) => call !== "POST /api/grievances/{id}/resolve"),
  },
  cities: ["Gurgaon"],
  every_city: true,
} satisfies OpsReply<"/api/whoami">);

import * as opsCopy from "../../apps/ops/src/content.ts";

const FIRST = GRIEVANCES.grievances[0];
const RESOLVE = `/api/grievances/${FIRST?.id ?? ""}/resolve` as const;
const ANSWER_IT: Call = `POST ${RESOLVE}`;

async function open(page: Page, resolve = json({ state: "resolved" })): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json(GRIEVANCES), [ANSWER_IT]: resolve });
  await page.goto("/grievances");
  await expect(page.getByRole("heading", { level: 1, name: opsCopy.grievances.title })).toBeVisible();
}

// The list's panel is titled as its page, its heading read rather than shown again.
const queue = (page: Page) => page.getByRole("region", { name: opsCopy.grievances.title });
const row = (page: Page, name: string) => queue(page).getByRole("row").filter({ hasText: name });

/** Opens a concern from its row, in a drawer by the client's name. */
async function opened(page: Page, name: string) {
  await queue(page)
    .getByRole("button", { name: opsCopy.grievances.queue.openLabel(name) })
    .click();
  return page.getByRole("dialog", { name });
}

test("lists every open concern a row each, says how many beside the title, and opens one whole", async ({ page }) => {
  await open(page);
  await expect(queue(page).getByRole("rowheader")).toHaveCount(2);
  await expect(page.getByRole("main").getByText(opsCopy.grievances.queue.openCount(2), { exact: true })).toBeVisible();

  const drawer = await opened(page, "Rohit Malhotra");
  await expect(drawer).toContainText("+91 98100 04417 · raised 14 Sep 2027");
  await expect(drawer.getByText(FIRST?.text ?? "")).toBeVisible();
});

test("says how long is left of the answer time, and marks one that has run over", async ({ page }) => {
  await open(page);
  await expect(row(page, "Rohit Malhotra")).toContainText("22 days left");
  await expect(row(page, "Vikram Sethi")).toContainText("22 days overdue");
});

test("reaches the client’s record from the name", async ({ page }) => {
  await open(page);
  const drawer = await opened(page, "Rohit Malhotra");
  await drawer.getByRole("link", { name: "Rohit Malhotra", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001/consents");
});

// Ops answer on the number shown, and copied it by hand to do so.
test("reaches the client on WhatsApp or by phone from the concern", async ({ page }) => {
  await open(page);
  const drawer = await opened(page, "Rohit Malhotra");
  await expect(drawer.getByRole("link", { name: "WhatsApp Rohit Malhotra" })).toHaveAttribute(
    "href",
    "https://wa.me/919810004417",
  );
  await expect(drawer.getByRole("link", { name: "Call Rohit Malhotra on +91 98100 04417" })).toHaveAttribute(
    "href",
    "tel:+919810004417",
  );
});

test("will not close a concern with no answer written", async ({ page }) => {
  await open(page);
  const drawer = await opened(page, "Rohit Malhotra");
  await expect(drawer.getByRole("button", { name: opsCopy.grievances.queue.send })).toBeDisabled();
});

test("records the answer, and the concern leaves the list", async ({ page }) => {
  await open(page);
  const drawer = await opened(page, "Rohit Malhotra");
  await drawer.getByRole("textbox", { name: opsCopy.grievances.queue.label }).fill("Taken off the launch list today.");

  const sent = page.waitForRequest((request) => request.url().endsWith(RESOLVE) && request.method() === "POST");
  await drawer.getByRole("button", { name: opsCopy.grievances.queue.send }).click();
  expect((await sent).postDataJSON()).toEqual({ response: "Taken off the launch list today." });
  await expect(drawer).toBeHidden();
  await expect(row(page, "Rohit Malhotra")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: opsCopy.grievances.queue.closed("Rohit Malhotra") }),
  ).toBeVisible();
  // The row is gone, so the keyboard goes to the list's heading and not to the top of the page.
  await expect(page.getByRole("heading", { level: 2, name: opsCopy.grievances.title })).toBeFocused();
  await expect(page.getByRole("main").getByText(opsCopy.grievances.queue.openCount(1), { exact: true })).toBeVisible();
});

// Grievances are a group on the Tasks board, which links each to its row here.
test("opens the concern a task named", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json(GRIEVANCES) });
  await page.goto(`/grievances#grievance-${FIRST?.id ?? ""}`);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
});

test("says so when someone has answered it already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const drawer = await opened(page, "Rohit Malhotra");
  await drawer.getByRole("textbox", { name: opsCopy.grievances.queue.label }).fill("Answered on WhatsApp.");
  await drawer.getByRole("button", { name: opsCopy.grievances.queue.send }).click();
  await expect(page.getByText("Already answered. Here’s the latest.")).toBeVisible();
});

test("says when more are open than the list holds", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json({ ...GRIEVANCES, more: true }) });
  await page.goto("/grievances");
  await expect(queue(page).getByText(opsCopy.firstShown(2))).toBeVisible();
});

test("says so when no concern is open, and nothing beside the title", async ({ page }) => {
  await answer(page, { "GET /api/grievances": json({ grievances: [], more: false }) });
  await page.goto("/grievances");
  await expect(page.getByText(opsCopy.grievances.queue.empty)).toBeVisible();
  await expect(page.getByRole("main").getByText(opsCopy.grievances.queue.openCount(0), { exact: true })).toHaveCount(0);
});

test("offers no answer to someone who may only read the concerns", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/grievances": json(GRIEVANCES), "GET /api/whoami": READ_ONLY });
  await page.goto("/grievances");
  const drawer = await opened(page, "Rohit Malhotra");
  await expect(drawer.getByText(FIRST?.text ?? "")).toBeVisible();
  await expect(drawer.getByRole("textbox", { name: opsCopy.grievances.queue.label })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: opsCopy.grievances.queue.send })).toHaveCount(0);
});

test("holds the list's room while it is read", async ({ page }) => {
  await answer(page, {
    "GET /api/grievances": async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      return json(GRIEVANCES)(route);
    },
  });
  await page.goto("/grievances");
  await expect(page.getByRole("main").getByText(states.loading)).toBeVisible();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/grievances": fails(503, "unavailable") });
  await page.goto("/grievances");
  await expect(page.getByRole("alert")).toContainText(opsCopy.states.failed);

  await answer(page, { "GET /api/grievances": json(GRIEVANCES) });
  await page.getByRole("button", { name: opsCopy.states.retry }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with a concern open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);
  await opened(page, "Rohit Malhotra");
  expect(await axeViolations(page)).toEqual([]);
});

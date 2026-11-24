// Number changes: the changes waiting for ops to confirm, both numbers already
// proven by code (docs/decisions/0042-client-profile.md). The API is answered
// from e2e/ops/fixtures.ts, since a change is started in a client's own app and
// needs a code sent to each number. The clock is fixed to the day the
// fixture's dates are read against, so the days left mean the same on every run.

import type { Page } from "@playwright/test";
import { DISMISS } from "../../packages/ui/words.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, json, NUMBER_CHANGES, TASKS_READ_ON, type Call, type OpsReply } from "./fixtures.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { states } from "../../packages/ui/words.ts";
/** Someone who may read the number changes but not decide them: every call but the decision. */
const READ_ONLY = json({
  signed_in_as: "care@localhost",
  sign_out: null,
  staff: {
    enforced: true,
    listed: true,
    grants: [{ department: "operations", level: "view", geography: "national", place: null }],
    may_call: Object.keys(ROUTE_NEEDS).filter((call) => call !== "POST /api/number-changes/{id}/decision"),
  },
  cities: ["Gurgaon"],
  every_city: true,
} satisfies OpsReply<"/api/whoami">);

import * as opsCopy from "../../apps/ops/src/content.ts";

const CHANGE = NUMBER_CHANGES.changes[0]?.id ?? "";
const DECISION = `/api/number-changes/${CHANGE}/decision` as const;
const DECIDE: Call = `POST ${DECISION}`;

async function open(page: Page, decision = json({ state: "confirmed" }), path = "/number-changes"): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/number-changes": json(NUMBER_CHANGES), [DECIDE]: decision });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: opsCopy.numberChanges.title })).toBeVisible();
}

const words = opsCopy.numberChanges.queue;
// The list's panel is titled as its page, its heading read rather than shown again.
const queue = (page: Page) => page.getByRole("region", { name: opsCopy.numberChanges.title });
const row = (page: Page) => queue(page).getByRole("row").filter({ hasText: "Rohit Malhotra" });

/** Opens the change from the client's name, in a drawer by their name. */
async function opened(page: Page) {
  await queue(page)
    .getByRole("button", { name: words.openLabel("Rohit Malhotra") })
    .click();
  return page.getByRole("dialog", { name: "Rohit Malhotra" });
}

/** Declines from the row, which opens the drawer at its reason. */
async function declining(page: Page) {
  await queue(page)
    .getByRole("button", { name: words.rejectLabel("Rohit Malhotra") })
    .click();
  return page.getByRole("dialog", { name: "Rohit Malhotra" });
}

test("lists each change a row: both numbers, when it was asked, its check; says how many beside the title", async ({
  page,
}) => {
  await open(page);
  await expect(queue(page).getByRole("rowheader")).toHaveCount(1);
  await expect(row(page)).toContainText("+91 98100 04417");
  await expect(row(page)).toContainText("+91 98100 04421");
  await expect(row(page)).toContainText(words.checked);
  await expect(page.getByRole("main").getByText(words.toDecide(1), { exact: true })).toBeVisible();

  const drawer = await opened(page);
  await expect(drawer).toContainText("+91 98100 04417 → +91 98100 04421");
  await expect(drawer).toContainText("Requested 21 Sep 2027");
  await expect(drawer).toContainText(words.proven);
});

// The change is confirmed with the client on the new number, which had to be copied by hand.
test("reaches the client on the new number, on WhatsApp or by phone", async ({ page }) => {
  await open(page);
  const drawer = await opened(page);
  await expect(drawer.getByRole("link", { name: "WhatsApp Rohit Malhotra" })).toHaveAttribute(
    "href",
    "https://wa.me/919810004421",
  );
  await expect(drawer.getByRole("link", { name: "Call Rohit Malhotra on +91 98100 04421" })).toHaveAttribute(
    "href",
    "tel:+919810004421",
  );
});

// A number change once showed no age at all; it falls due when the Tasks board says it does.
test("says how long the change has left, as the Tasks board counts it", async ({ page }) => {
  await open(page);
  await expect(row(page)).toContainText("1 day left");
});

test("reaches the client’s record from the name", async ({ page }) => {
  await open(page);
  const drawer = await opened(page);
  await drawer.getByRole("link", { name: "Rohit Malhotra", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe("/clients/22000000-0000-4000-8000-000000000001/visits");
});

test("approves the change from its row, and it leaves the list", async ({ page }) => {
  await open(page);
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await queue(page)
    .getByRole("button", { name: words.confirmLabel("Rohit Malhotra") })
    .click();
  expect((await sent).postDataJSON()).toEqual({ decision: "confirm", reason: null });
  await expect(row(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: words.confirmed("Rohit Malhotra") })).toBeVisible();
  await expect(page.getByText(words.empty)).toBeVisible();
  await expect(page.getByRole("main").getByText(words.toDecide(0), { exact: true })).toHaveCount(0);
});

test("declines with a reason, which it will not send without", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  const drawer = await declining(page);
  const send = drawer.getByRole("button", { name: words.reason.confirm });
  await expect(send).toBeDisabled();

  await drawer.getByRole("textbox", { name: words.reason.label }).fill("The client says they did not ask.");
  const sent = page.waitForRequest((request) => request.url().endsWith(DECISION) && request.method() === "POST");
  await send.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "reject", reason: "The client says they did not ask." });
  await expect(drawer).toBeHidden();
  await expect(row(page)).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: words.rejected("Rohit Malhotra") })).toBeVisible();
});

test("leaves the change waiting when the decline is called off", async ({ page }) => {
  await open(page);
  const drawer = await declining(page);
  await drawer.getByRole("button", { name: DISMISS.cancel }).click();
  await expect(drawer.getByRole("button", { name: words.confirm, exact: true })).toBeVisible();
  // The keyboard goes back to the button that asked, not to the top of the drawer.
  await expect(drawer.getByRole("button", { name: words.reject, exact: true })).toBeFocused();
});

test("moves the keyboard into the reason as it opens, and to the heading once decided", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  const drawer = await declining(page);
  const reason = drawer.getByRole("textbox", { name: words.reason.label });
  await expect(reason).toBeFocused();
  await reason.fill("The client says they did not ask.");
  await drawer.getByRole("button", { name: words.reason.confirm }).click();
  await expect(page.getByRole("heading", { level: 2, name: opsCopy.numberChanges.title })).toBeFocused();
});

// The Tasks board links a number change to its row here.
test("opens the change a task named", async ({ page }) => {
  await open(page, undefined, `/number-changes#change-${CHANGE}`);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
});

// The API answers with the code alone, so the console says whose number it is.
test("says so when another client already holds the new number", async ({ page }) => {
  await open(page, fails(409, "number_in_use"));
  await queue(page)
    .getByRole("button", { name: words.confirmLabel("Rohit Malhotra") })
    .click();
  // Said in the row it answers, so with several waiting it is plain whose it is.
  await expect(row(page).getByRole("alert")).toContainText(words.errors.number_in_use);
});

test("says so when someone has decided it already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  await queue(page)
    .getByRole("button", { name: words.confirmLabel("Rohit Malhotra") })
    .click();
  await expect(page.getByText("Already decided. Here’s the latest.")).toBeVisible();
});

test("says so when nothing is waiting, and nothing beside the title", async ({ page }) => {
  await answer(page, { "GET /api/number-changes": json({ changes: [] }) });
  await page.goto("/number-changes");
  await expect(page.getByText(words.empty)).toBeVisible();
  await expect(page.getByRole("main").getByText(words.toDecide(0), { exact: true })).toHaveCount(0);
});

test("offers no Approve or Decline to someone who may only read the changes", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/number-changes": json(NUMBER_CHANGES), "GET /api/whoami": READ_ONLY });
  await page.goto("/number-changes");
  await expect(row(page)).toBeVisible();
  await expect(queue(page).getByRole("button", { name: words.confirmLabel("Rohit Malhotra") })).toHaveCount(0);
  await expect(queue(page).getByRole("button", { name: words.rejectLabel("Rohit Malhotra") })).toHaveCount(0);
  const drawer = await opened(page);
  await expect(drawer.getByRole("button", { name: words.confirm, exact: true })).toHaveCount(0);
});

test("keeps Approve off where the new number is another client's, and says so in the row", async ({ page }) => {
  const held = {
    changes: NUMBER_CHANGES.changes.map((each) => ({
      ...each,
      new_number_held_by: { name: "Vikram Sethi", client: true },
    })),
  } satisfies OpsReply<"/api/number-changes">;
  await open(page);
  await answer(page, { "GET /api/number-changes": json(held) });
  await page.reload();
  await expect(row(page)).toContainText(words.heldByClient("Vikram Sethi"));
  await expect(queue(page).getByRole("button", { name: words.confirmLabel("Rohit Malhotra") })).toBeDisabled();
});

test("holds the list's room while it is read", async ({ page }) => {
  await answer(page, {
    "GET /api/number-changes": async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      return json(NUMBER_CHANGES)(route);
    },
  });
  await page.goto("/number-changes");
  await expect(page.getByRole("main").getByText(states.loading)).toBeVisible();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("says so when the list cannot be loaded, and loads it on Try again", async ({ page }) => {
  await answer(page, { "GET /api/number-changes": fails(503, "unavailable") });
  await page.goto("/number-changes");
  await expect(page.getByRole("alert")).toContainText(opsCopy.states.failed);

  await answer(page, { "GET /api/number-changes": json(NUMBER_CHANGES) });
  await page.getByRole("button", { name: opsCopy.states.retry }).click();
  await expect(page.getByText("Rohit Malhotra")).toBeVisible();
});

test("meets WCAG 2.2 AA with the list, and with a decline open", async ({ page }) => {
  await open(page);
  expect(await axeViolations(page)).toEqual([]);

  await declining(page);
  expect(await axeViolations(page)).toEqual([]);
});

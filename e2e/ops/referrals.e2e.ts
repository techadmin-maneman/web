// Referrals: the held queue and the referrers' figures,
// with the API answered from e2e/ops/fixtures.ts, since no route can put a
// grant into the held state from outside. The clock is fixed to the day the
// fixture's holds are read against, so "3 days held" reads the same on every run.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, fails, HELD, json, REFERRERS, TASKS_READ_ON, type Call } from "./fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const FIRST = "Rohit Malhotra → Vikram Sethi";
const GRANT = HELD.held[0]?.id ?? "";
const DECIDE: Call = `POST /api/referrals/${GRANT}/decision`;

async function open(page: Page, decision = json({ state: "approved" }), path = "/referrals"): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/referrals/held": json(HELD),
    "GET /api/referrers": json(REFERRERS),
    [DECIDE]: decision,
  });
  await page.goto(path);
  await expect(page.getByRole("heading", { name: opsCopy.referrals.queue.title })).toBeVisible();
}

test("lists every held grant with the rule it met, and counts them", async ({ page }) => {
  await open(page);
  const queue = page.getByRole("region", { name: opsCopy.referrals.queue.title });
  await expect(queue.getByRole("listitem").filter({ hasText: "→" })).toHaveCount(3);
  await expect(queue.getByText(FIRST)).toBeVisible();
  await expect(queue.getByText(opsCopy.referrals.queue.signals.shared_address)).toBeVisible();
  await expect(queue.getByText(opsCopy.referrals.queue.signals.shared_upi)).toBeVisible();
  await expect(queue.getByText(opsCopy.referrals.queue.signals.monthly_cap)).toBeVisible();
});

// The design writes how long a grant has waited; the queue once wrote the day of the first fit.
test("says how long each grant has been held, as the board writes it", async ({ page }) => {
  await open(page);
  const queue = page.getByRole("region", { name: opsCopy.referrals.queue.title });
  await expect(queue.getByRole("listitem").filter({ hasText: FIRST })).toContainText("3 days held");
  await expect(queue.getByRole("listitem").filter({ hasText: "Ashish Gill" })).toContainText("1 day held");
  await expect(queue.getByRole("listitem").filter({ hasText: "Karan Bose" })).toContainText("5 hours held");
});

// The held pair's names were plain text though the route gives both clients' IDs.
test("reaches either client’s page from the pair", async ({ page }) => {
  await open(page);
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("link", { name: "Vikram Sethi" }).click();
  expect(new URL(page.url()).pathname).toBe(`/clients/${HELD.held[0]?.referred.person_id ?? ""}/referrals`);
});

test("asks why before it approves one, and sends the reason with the approval", async ({ page }) => {
  await open(page);
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: opsCopy.referrals.queue.approve, exact: true }).click();

  // The field takes the keyboard as it opens, where the button stood.
  await expect(grant.getByLabel(opsCopy.referrals.queue.reason.label.approve)).toBeFocused();
  const confirm = grant.getByRole("button", { name: opsCopy.referrals.queue.reason.confirm.approve });
  await expect(confirm).toBeDisabled();
  await grant.getByLabel(opsCopy.referrals.queue.reason.label.approve).fill("Father and son, two households");
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await confirm.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "approve", reason: "Father and son, two households" });
  await expect(page.getByText(FIRST)).toBeHidden();
  // The row is gone, so the keyboard goes to the queue's heading and not to the top of the page.
  await expect(page.getByRole("heading", { name: opsCopy.referrals.queue.title })).toBeFocused();
});

test("asks why before it rejects one, and will not send an empty reason", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: opsCopy.referrals.queue.reject, exact: true }).click();

  const confirm = grant.getByRole("button", { name: opsCopy.referrals.queue.reason.confirm.reject });
  await expect(confirm).toBeDisabled();
  await grant.getByLabel(opsCopy.referrals.queue.reason.label.reject).fill("Same flat, one household");
  const sent = page.waitForRequest((request) => request.url().includes("/decision") && request.method() === "POST");
  await confirm.click();
  expect((await sent).postDataJSON()).toEqual({ decision: "reject", reason: "Same flat, one household" });
  await expect(page.getByText(FIRST)).toBeHidden();
});

test("hands the keyboard back to the button that asked when the reason is not given", async ({ page }) => {
  await open(page);
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: opsCopy.referrals.queue.reject, exact: true }).click();
  await grant.getByRole("button", { name: opsCopy.referrals.queue.reason.cancel }).click();
  await expect(grant.getByRole("button", { name: opsCopy.referrals.queue.reject, exact: true })).toBeFocused();
});

test("says so when someone else has decided the grant already", async ({ page }) => {
  await open(page, fails(404, "not_found"));
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: opsCopy.referrals.queue.approve, exact: true }).click();
  await grant.getByLabel(opsCopy.referrals.queue.reason.label.approve).fill("Two households at one address");
  await grant.getByRole("button", { name: opsCopy.referrals.queue.reason.confirm.approve }).click();
  await expect(page.getByText("Already decided. Here’s the latest.")).toBeVisible();
  await expect(page.getByText(FIRST)).toBeVisible();
});

// A grant held for a consultation and fit not yet paid can be rejected, and approved once it is paid.
test("says an approval waits for the friend’s payment, and keeps the grant held", async ({ page }) => {
  await open(page, fails(409, "not_paid"));
  const grant = page.getByRole("listitem").filter({ hasText: FIRST });
  await grant.getByRole("button", { name: opsCopy.referrals.queue.approve, exact: true }).click();
  await grant.getByLabel(opsCopy.referrals.queue.reason.label.approve).fill("Two households at one address");
  await grant.getByRole("button", { name: opsCopy.referrals.queue.reason.confirm.approve }).click();
  await expect(page.getByRole("alert")).toContainText("The friend hasn’t paid yet");
  await expect(page.getByText(FIRST)).toBeVisible();
});

// The Tasks board links a referral review to its row here.
test("brings the grant a task named into view, and gives it the keyboard", async ({ page }) => {
  await open(page, undefined, `/referrals#held-${GRANT}`);
  await expect(page.getByRole("listitem").filter({ hasText: FIRST })).toBeFocused();
});

test("shows every referrer’s figures, the busiest first, as the route orders them", async ({ page }) => {
  await open(page);
  const rows = page.getByRole("row");
  await expect(rows.nth(1)).toContainText("Karan Bose");
  await expect(rows.nth(1)).toContainText("19");
  // Each name opens the referrer's page.
  await expect(rows.nth(1).getByRole("link", { name: "Karan Bose" })).toHaveAttribute(
    "href",
    `/clients/${REFERRERS.referrers[0]?.person_id ?? ""}/referrals`,
  );
  await expect(page.getByRole("button", { name: opsCopy.referrals.table.more })).toBeHidden();
});

test("reads the referrers a page at a time", async ({ page }) => {
  const second = {
    referrers: [
      {
        code: "NA1234",
        person_id: "11000000-0000-4000-8000-000000000006",
        name: "Nikhil Arora",
        opens: 5,
        consultations: 1,
        fits: 1,
        granted: 3,
        redeemed: 1,
      },
    ],
    next_cursor: null,
  };
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/referrals/held": json(HELD),
    "GET /api/referrers": (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      return json(cursor === null ? { ...REFERRERS, next_cursor: "NA" } : second)(route);
    },
  });
  await page.goto("/referrals");

  const asked = page.waitForRequest((request) => request.url().includes("/api/referrers?cursor=NA"));
  await page.getByRole("button", { name: opsCopy.referrals.table.more }).click();
  await asked;
  await expect(page.getByRole("row").filter({ hasText: "Nikhil Arora" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Karan Bose" })).toBeVisible();
  await expect(page.getByRole("button", { name: opsCopy.referrals.table.more })).toBeHidden();
});

test("says nothing is held when the queue is empty", async ({ page }) => {
  await answer(page, { "GET /api/referrals/held": json({ held: [] }), "GET /api/referrers": json(REFERRERS) });
  await page.goto("/referrals");
  await expect(page.getByText(opsCopy.referrals.queue.empty)).toBeVisible();
});

test("says so when the queue cannot be loaded, and loads it on Try again", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/referrals/held": fails(503, "unavailable"), "GET /api/referrers": json(REFERRERS) });
  await page.goto("/referrals");
  await expect(page.getByRole("alert")).toContainText(opsCopy.states.failed);

  await answer(page, { "GET /api/referrals/held": json(HELD), "GET /api/referrers": json(REFERRERS) });
  await page.getByRole("button", { name: opsCopy.states.retry }).click();
  await expect(page.getByText(FIRST)).toBeVisible();
});

test("meets WCAG 2.2 AA with a queue, and with a rejection open", async ({ page }) => {
  await open(page, json({ state: "rejected" }));
  expect(await axeViolations(page)).toEqual([]);

  await page
    .getByRole("listitem")
    .filter({ hasText: FIRST })
    .getByRole("button", { name: opsCopy.referrals.queue.reject, exact: true })
    .click();
  expect(await axeViolations(page)).toEqual([]);
});

test("sorts the referrers by a column, and finds one by name", async ({ page }) => {
  await open(page);
  const referrers = page.getByRole("region", { name: opsCopy.referrals.table.title });
  const rows = referrers.getByRole("row");
  await expect(rows.nth(1)).toContainText("Karan Bose");
  await referrers.getByRole("button", { name: opsCopy.referrals.table.columns.fits, exact: true }).click();
  await expect(referrers.getByRole("columnheader", { name: opsCopy.referrals.table.columns.fits })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await expect(rows.nth(1)).toContainText("Vikram Sethi");
  await referrers.getByLabel(opsCopy.tables.search).fill("rohit");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Rohit Malhotra");
});

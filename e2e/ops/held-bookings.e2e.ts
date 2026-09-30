// A booking FSM refused five times running, held for ops with its slot and its payment
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md): the Tasks board's "Booking not in FSM" leads to the client's
// Visits tab, which heads with it and the four things ops may do. The API is answered from e2e/ops/fixtures.ts,
// since only FSM refusing a real booking five times puts one there. The clock is the fixtures' day.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import {
  answer,
  CLIENT,
  CONSENTS,
  fails,
  HELD_BOOKING,
  json,
  PIECES,
  RECORD,
  TASKS_READ_ON,
  type Answers,
  type Call,
  type OpsReply,
} from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const HELD = `/api/held-bookings/${HELD_BOOKING.id}` as const;
const RETRY: Call = `POST ${HELD}/retry`;
const STOP: Call = `POST ${HELD}/stop`;
const LINK: Call = `POST ${HELD}/link`;
const REFUND: Call = `POST ${HELD}/refund`;
/** The visit ops booked in FSM by hand, as the mirror brought it in: the record's one to come. */
const BOOKED_BY_HAND = RECORD.visits.upcoming[0]?.id ?? "";

const WITH_HELD = { ...RECORD, held_bookings: [HELD_BOOKING] } satisfies OpsReply<"/api/clients/{id}">;

async function openVisits(page: Page, over: Answers = {}): Promise<void> {
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    [`GET /api/clients/${CLIENT.id}`]: json(WITH_HELD),
    [`GET /api/clients/${CLIENT.id}/pieces`]: json(PIECES),
    [`GET /api/clients/${CLIENT.id}/consents`]: json(CONSENTS),
    ...over,
  });
  await page.goto(`/clients/${CLIENT.id}/visits`);
}

const held = (page: Page) => page.getByRole("region", { name: "Not in FSM yet" });

test("heads the Visits tab with the booking, what was paid, what FSM said and until when it is tried", async ({
  page,
}) => {
  await openVisits(page);
  const booking = held(page).getByRole("listitem");
  await expect(booking).toContainText("Service visit, 25 Sep 2027, 9 am");
  await expect(booking).toContainText("Paid Rs. 2,000");
  await expect(booking).toContainText("FSM said: Zoho 400 INVALID_DATA");
  await expect(booking).toContainText("Tried again automatically until 23 Sep 2027, 11:30 am.");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("tries FSM again, and says it is booked and the client told", async ({ page }) => {
  await openVisits(page, { [RETRY]: json({ outcome: "booked", refusal: null }) });
  await held(page)
    .getByRole("button", { name: /Try FSM again/ })
    .click();
  await expect(held(page).getByRole("status")).toHaveText("Booked in FSM. The client is told.");
  await expect(held(page).getByRole("button")).toHaveCount(0);
});

test("says what FSM said when it refuses again, and leaves the actions", async ({ page }) => {
  await openVisits(page, { [RETRY]: json({ outcome: "refused", refusal: "Zoho 429 TOO_MANY" }) });
  await held(page)
    .getByRole("button", { name: /Try FSM again/ })
    .click();
  await expect(held(page).getByRole("status")).toHaveText("FSM refused it again: Zoho 429 TOO_MANY");
  await expect(held(page).getByRole("button", { name: /Refund it/ })).toBeVisible();
});

test("stops the hourly tries before ops book it in FSM by hand, and says to link it once booked", async ({ page }) => {
  let stopped = 0;
  await openVisits(page, {
    [STOP]: async (route) => {
      stopped += 1;
      await json({ stopped: true })(route);
    },
  });
  await held(page)
    .getByRole("button", { name: /Stop trying — I'll book it in FSM/ })
    .click();

  await expect(held(page).getByRole("status")).toHaveText(
    "The hourly tries are stopped. Book it in FSM, then link it here.",
  );
  const booking = held(page).getByRole("listitem");
  await expect(booking).toContainText("No longer tried automatically. Book it in FSM and link it, or refund it.");
  await expect(held(page).getByRole("button", { name: /Stop trying/ })).toHaveCount(0);
  await expect(held(page).getByRole("button", { name: /Link the visit I booked in FSM/ })).toBeVisible();
  expect(stopped).toBe(1);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("says a visit of theirs reached FSM when a try finds one, and leaves it to link", async ({ page }) => {
  await openVisits(page, { [RETRY]: json({ outcome: "to_link", refusal: null }) });
  await held(page)
    .getByRole("button", { name: /Try FSM again/ })
    .click();
  await expect(held(page).getByRole("status")).toHaveText(
    "A visit of theirs of this kind reached FSM after it was held, so nothing was written. If it is the one you " +
      "booked, link it.",
  );
  await expect(held(page).getByRole("button", { name: /Link the visit I booked in FSM/ })).toBeVisible();
});

test("says a try is writing it when ops try FSM again at the same moment", async ({ page }) => {
  await openVisits(page, { [RETRY]: fails(409, "superseded") });
  await held(page)
    .getByRole("button", { name: /Try FSM again/ })
    .click();
  await expect(held(page).getByRole("alert")).toHaveText(
    "A try is writing it to FSM right now. Reload in a minute to see how it went.",
  );
});

test("links the visit booked in FSM by hand, and says the work order an earlier try left is cancelled", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await openVisits(page, {
    [LINK]: async (route) => {
      sent.push(route.request().postDataJSON());
      await json({ fsm: { kind: "cancelled", work_order_id: "WO-0412" } })(route);
    },
  });
  await held(page)
    .getByRole("button", { name: /Link the visit I booked in FSM/ })
    .click();
  const visit = held(page).getByRole("combobox", { name: "The visit you booked in FSM" });
  await expect(visit).toBeFocused();
  await expect(visit.getByRole("option")).toHaveText(["Sat 25 Sep, 9 am"]);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await held(page)
    .getByRole("button", { name: /Link it/ })
    .click();

  await expect(held(page).getByRole("status")).toHaveText(
    "Linked to that visit. The client is told.Its work order WO-0412 is cancelled in FSM.",
  );
  expect(sent).toEqual([{ visit_id: BOOKED_BY_HAND }]);
});

test("refunds only once ops have read what it does, and says what happened to the money and to FSM", async ({
  page,
}) => {
  await openVisits(page, {
    [REFUND]: json({
      money: { kind: "refunded", payment_id: "pay_Q8x2", amount: 200_000 },
      fsm: { kind: "nothing", work_order_id: null },
    }),
  });
  await held(page)
    .getByRole("button", { name: /Refund it/ })
    .click();
  const check = held(page).getByRole("group", { name: "Refund it" });
  await expect(check).toContainText("refund Rs. 2,000 to the client in full?");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await check.getByRole("button", { name: "Refund and let it go" }).click();

  await expect(held(page).getByRole("status")).toHaveText(
    "Refunded Rs. 2,000 in full (Razorpay payment pay_Q8x2). The client is told.",
  );
  await expect(held(page).getByRole("button")).toHaveCount(0);
});

test("keeps the booking waiting when Razorpay refuses the refund, and says so", async ({ page }) => {
  await openVisits(page, {
    [REFUND]: json({
      money: { kind: "refund_refused", payment_id: "pay_Q8x2", amount: 200_000 },
      fsm: { kind: "nothing", work_order_id: null },
    }),
  });
  await held(page)
    .getByRole("button", { name: /Refund it/ })
    .click();
  await held(page).getByRole("button", { name: "Refund and let it go" }).click();
  await expect(held(page).getByRole("status")).toContainText("Razorpay refused to refund Rs. 2,000");
  await expect(held(page).getByRole("button", { name: /Try FSM again/ })).toBeVisible();
});

test("says so when the booking was booked or refunded meanwhile", async ({ page }) => {
  await openVisits(page, { [RETRY]: fails(404, "not_found") });
  await held(page)
    .getByRole("button", { name: /Try FSM again/ })
    .click();
  await expect(held(page).getByRole("alert")).toHaveText(
    "It is no longer waiting: it may have been booked or refunded. Reload the page.",
  );
});

test("is a task on the board that leads to the client's Visits tab", async ({ page }) => {
  await page.clock.setFixedTime(TASKS_READ_ON);
  const board = {
    overdue: 0,
    truncated: false,
    staff: ["ops@localhost"],
    groups: [
      {
        group: "held_booking",
        count: 1,
        closable: false,
        tasks: [
          {
            id: HELD_BOOKING.id,
            person: { id: CLIENT.id, name: CLIENT.name },
            detail: "service 2027-09-25 morning",
            since: HELD_BOOKING.held_at,
            due: "2027-09-23T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  } satisfies OpsReply<"/api/tasks">;
  await answer(page, { "GET /api/tasks": json(board) });
  await page.goto("/tasks");
  const tasks = page.getByRole("region", { name: "Tasks" });
  await expect(tasks.getByRole("heading", { level: 3 })).toHaveText(["Booking not in FSM"]);
  await expect(tasks.getByRole("listitem")).toContainText("Service visit, Sat 25 Sep, morning; FSM refused it");
  await expect(tasks.getByRole("link", { name: CLIENT.name })).toHaveAttribute("href", `/clients/${CLIENT.id}/visits`);
});

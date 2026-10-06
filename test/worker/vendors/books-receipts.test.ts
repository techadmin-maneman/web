// What a Books receipt says the money was for (src/domain/books/books-sync.ts): its description of supply, which Books prints
// under the amount. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { NO_GST } from "../../../src/config/gst.ts";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/ops/alerts.ts";
import { syncBooks } from "../../../src/domain/books/books-sync.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import { IMRAN, technician } from "../clients.ts";
import { markDatabase, NOW } from "../helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
/** When the payments were taken: 1:30 am on Monday 21 September in India. */
const TAKEN = "2026-09-20T20:00:00.000Z";

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, books_customer_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'books-customer-9')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

/** A first fit starting at `start`. */
async function firstFit(start: string) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
     VALUES (?1, ?1, ?2, 'first_fit', 'scheduled', ?3, ?4)`,
  )
    .bind(VISIT, PERSON, start, NOW.toISOString())
    .run();
}

/** A captured payment, numbered `n`, for the first fit, for a booking by its order, or for neither. */
async function payment(n: number, paidFor: { visit?: string; order?: string; kind?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount,
       currency, status, captured_at, created_at, updated_at, kind)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 3000000, 'INR', 'captured', ?7, ?7, ?7, ?8)`,
  )
    .bind(
      `payment-${String(n)}`,
      `MM-2026-084${String(n)}`,
      PERSON,
      paidFor.visit ?? null,
      paidFor.order ?? null,
      `pay_test4${String(n)}`,
      // Taken a minute apart, so the pass records them in this order.
      new Date(Date.parse(TAKEN) + n * 60_000).toISOString(),
      paidFor.kind ?? "visit",
    )
    .run();
}

/** One pass; what each payment it recorded says it was for. */
async function receipts(): Promise<string[]> {
  const books = createStubBooks();
  const deps = {
    books,
    alertOnce: createAlertOnce({
      db: env.DB,
      alert: () => Promise.resolve(),
      now: () => NOW,
      environment: "local",
      log: createLogger(),
    }),
    resolveAlert: createResolveAlert({ db: env.DB, now: () => NOW }),
  };
  const options = { refundAccountId: null, labelAsTest: false, gst: NO_GST };
  await syncBooks({ db: env.DB, deps, options, now: NOW, log: createLogger(), budget: createCallBudget(Infinity) });
  return books.made.payments.map((each) => each.supply);
}

it("says a payment taken before the visit, as every booking is, is an advance for it", async () => {
  await firstFit("2026-09-25T04:30:00.000Z");
  await payment(1, { visit: VISIT });
  expect(await receipts()).toEqual(["Advance for First fit, Fri 25 Sep"]);
});

it("says a payment taken once the visit began, by link at the door, is for the visit", async () => {
  await firstFit("2026-09-20T19:30:00.000Z");
  await payment(1, { visit: VISIT });
  expect(await receipts()).toEqual(["First fit, Mon 21 Sep"]);
});

it("says what a late fee was for", async () => {
  await firstFit("2026-09-25T04:30:00.000Z");
  await payment(1, { visit: VISIT, kind: "late_fee" });
  expect(await receipts()).toEqual(["Late fee, First fit, Fri 25 Sep"]);
});

it("names the booking a payment was for while it is not a visit yet, and says only Payment where nothing is known", async () => {
  await technician();
  await env.DB.prepare(
    `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
       gst_percent, state, razorpay_order_id, expires_at, created_at, updated_at)
     VALUES ('hold-1', ?1, 'replacement', '2026-10-03', 'morning', ?2, 0, 3000000, 3000000, 0, 'held', 'order_test1',
       ?3, ?3, ?3)`,
  )
    .bind(PERSON, IMRAN, NOW.toISOString())
    .run();
  await payment(1, { order: "order_test1" });
  await payment(2);

  expect(await receipts()).toEqual(["Advance for Replacement, Sat 3 Oct", "Payment"]);
});

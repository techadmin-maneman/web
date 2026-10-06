// Booking, moving and cancelling: each is written in the request that makes it. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { bookUnbookedHolds } from "../../../src/domain/booking/unbooked-holds.ts";
import { confirmBooking } from "../../../src/domain/booking/bookings.ts";
import { giveBack } from "../../../src/domain/booking/give-back.ts";
import { creditBalance, grantCredits } from "../../../src/domain/money/credits.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { PaymentUnanswered } from "../../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import {
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  type TestDependencies,
} from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  at,
  cookies,
  messageQueue,
  useMessageQueue,
  webhook,
  payment,
  fittedClient,
  heldAndOrdered,
  holdRow,
  visitsOf,
} from "./booking-in-request-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  useMessageQueue(fakeQueue());
  await technician();
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
  ).run();
});

describe("a booking, after the request that confirmed it failed", () => {
  /** A service hold paid for, whose webhook recorded the payment but never booked it. */
  async function paidButUnbooked(paymentId: string, madeAt = at(30)) {
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
           captured_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'INR', 'upi', 'captured', ?6, ?6, ?6)`,
      ).bind(crypto.randomUUID(), PERSON, ordered.orderId, paymentId, ordered.amount, madeAt.toISOString()),
      env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2, queued_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        madeAt.toISOString(),
      ),
    ]);
    return ordered;
  }

  const pass = (deps: TestDependencies, seconds: number, budget = createCallBudget(40)) =>
    bookUnbookedHolds(env.DB, { ...deps, notify: () => Promise.resolve(), budget, log: createLogger() }, at(seconds));

  it("is booked by the half-hour pass", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_net");
    const deps = fakeDependencies();

    expect(await pass(deps, 29 * 60)).toBe(0);
    expect(await pass(deps, 32 * 60)).toBe(1);

    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops once of a booking it still cannot finish, and tries it again half an hour on", async () => {
    await fittedClient();
    // Paid past the hold's ten minutes and its grace, so it is to be refunded, which Razorpay refuses.
    const { holdId } = await paidButUnbooked("pay_refused", at(800));
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => {
        asked += 1;
        return Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR"));
      },
    };
    const deps = fakeDependencies({ payments: refusing });

    expect(await pass(deps, 50 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 60 * 60)).toBe(0);
    expect(asked).toBe(1);
    expect(await pass(deps, 81 * 60)).toBe(0);
    expect(asked).toBe(2);

    expect((await holdRow(holdId))?.state).toBe("held");
    expect(deps.alerts).toEqual([expect.stringMatching(new RegExp(`${holdId}.*/clients/${PERSON}`))]);
  });

  it("is booked by the cron's own job", async () => {
    await fittedClient();
    const { holdId } = await paidButUnbooked("pay_cron");
    const job = CRON_JOBS.filter((each) => each.name === "unbooked_holds");

    const outcomes = await runCronJobs(job, {
      env: { ...env, MESSAGE_QUEUE: messageQueue },
      deps: fakeDependencies({ now: () => at(32 * 60) }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "unbooked_holds", ok: true }]);
    expect((await holdRow(holdId))?.state).toBe("booked");
    expect(messageQueue.sent).toHaveLength(1);
  });
});

describe("confirmBooking", () => {
  it("answers already_booked for a hold it booked before, and writes nothing more", async () => {
    await fittedClient();
    await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o2", now: NOW }).run();
    const ordered = await heldAndOrdered();

    const again = await confirmBooking(
      { db: env.DB, payments: createStubPayments(), now: at(5), log: createLogger() },
      ordered.holdId,
    );

    expect(again).toBe("already_booked");
    expect((await visitsOf(PERSON, "service")).results).toHaveLength(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

// A refund Razorpay refused for a hold already let go was swallowed, the money kept and nobody told;
// and giving back a hold after a partial refund in Razorpay's dashboard refunded nothing of the rest.
describe("money owed back on a hold", () => {
  const refusing = (payments: PaymentsProvider): PaymentsProvider => ({
    ...payments,
    refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")),
  });

  it("tells ops at once of a late payment Razorpay will not refund, and lists it on Tasks", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(ordered.holdId),
      env.DB.prepare("UPDATE slot_holds SET state = 'released', updated_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        at(11 * 60).toISOString(),
      ),
    ]);
    const deps = fakeDependencies({ payments: refusing(createStubPayments()) });

    await webhook("payment.captured", "evt_late", payment("pay_late", ordered, at(13 * 60)), deps);

    expect(deps.alerts).toEqual([
      expect.stringContaining(
        `Booking ${ordered.holdId} owes back payment pay_late of Rs. 2,000, and Razorpay refused the refund.`,
      ),
    ]);
    const tasks = (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks;
    expect(tasks.filter((task) => task.group === "payment_to_refund")).toMatchObject([
      { person: { id: PERSON }, detail: "let_go 200000 pay_late" },
    ]);
  });

  // A refund Razorpay never answered may have been made, so ops are asked to look before they refund it.
  it("tells ops to check Razorpay first for a late payment whose refund went unanswered", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(ordered.holdId),
      env.DB.prepare("UPDATE slot_holds SET state = 'released', updated_at = ?2 WHERE id = ?1").bind(
        ordered.holdId,
        at(11 * 60).toISOString(),
      ),
    ]);
    const silent: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out."))),
    };
    const deps = fakeDependencies({ payments: silent });

    await webhook("payment.captured", "evt_late", payment("pay_late", ordered, at(13 * 60)), deps);

    expect(deps.alerts).toEqual([
      expect.stringContaining("and Razorpay did not say whether it refunded it. Check Razorpay's dashboard"),
    ]);
  });

  it("refunds what a partial refund in Razorpay's dashboard left when the hold is given back", async () => {
    await fittedClient();
    const ordered = await heldAndOrdered();
    await webhook("payment.captured", "evt_paid", payment("pay_part", ordered, at(13 * 60)), fakeDependencies());
    await env.DB.prepare(
      "UPDATE payments SET status = 'partially_refunded', refunded_amount = 50000 WHERE razorpay_payment_id = 'pay_part'",
    ).run();
    await env.DB.prepare("UPDATE slot_holds SET state = 'held', refunded_at = NULL WHERE id = ?1")
      .bind(ordered.holdId)
      .run();
    const payments = createStubPayments();

    expect(await giveBack({ db: env.DB, payments: payments, now: NOW }, ordered.holdId, "test")).toEqual({
      kind: "refunded",
      paymentId: "pay_part",
      amount: 150000,
    });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_part", amount: 150000 }]);
  });
});

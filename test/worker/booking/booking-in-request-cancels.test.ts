// Booking, moving and cancelling: each is written in the request that makes it. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { creditBalance, grantCredits, redeemCredit } from "../../../src/domain/money/credits.ts";
import { settleOwedRefunds } from "../../../src/domain/money/cancel-refunds.ts";
import {
  changeableVisit,
  changeTerms,
  opsCancelTerms,
  termsInForce,
} from "../../../src/domain/visits/visit-changes.ts";
import { cancelVisit, type OpsCancel } from "../../../src/domain/visits/visit-cancel.ts";
import { readOpsInputs } from "../../../src/domain/ops/ops-settings.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { PaymentUnanswered } from "../../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import {
  captureLogs,
  failingAfterTheFirstBatch,
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
  VISIT,
  PAYMENT,
  THURSDAY_NOON,
  at,
  cookies,
  messageQueue,
  useMessageQueue,
  call,
  fittedClient,
  booked,
  visitOf,
  messagesOf,
  changes,
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

describe("a visit cancelled by the client", () => {
  it("is cancelled and refunded in the request, its change, status and message written together", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const done = await call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      {
        method: "POST",
        body: { confirm: true, notice: "free" },
      },
      deps,
    );

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, refund: 200000, kept: 0, refund_pending: false });
    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect((await changes()).results).toEqual([
      {
        appointment_id: VISIT,
        kind: "cancelled",
        notice: "free",
        refund_amount: 200000,
        kept_amount: 0,
        payment_id: PAYMENT,
      },
    ]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(messageQueue.sent).toHaveLength(1);

    const again = await call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      {
        method: "POST",
        body: { confirm: true, notice: "free" },
      },
      deps,
    );
    expect(again.status).toBe(409);
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("writes nothing and refunds nothing for a visit the technician checked in to after the terms were read", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const visit = await changeableVisit(env.DB, PERSON, VISIT, NOW);
    if (visit === null) throw new Error("the visit should be changeable");
    const terms = await changeTerms({
      db: env.DB,
      visit,
      now: NOW,
      inForce: termsInForce(await readOpsInputs(env.DB, NOW), "service"),
    });
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES (?1, ?2, 'event-checkin-01', 't1', 'check_in', '{}', ?3, ?3, ?3)`,
    )
      .bind(crypto.randomUUID(), VISIT, NOW.toISOString())
      .run();
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const outcome = await cancelVisit({ db: env.DB, deps, terms, now: NOW, options: { log: createLogger() } });

    expect(outcome).toEqual({ kind: "not_changeable" });
    expect((await visitOf(VISIT))?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("a visit the client and ops cancel at the same moment", () => {
  const options = { log: createLogger() };
  const byOps: OpsCancel = {
    staff: "ops@localhost",
    reason: "Client phoned to cancel",
    terms: "free",
    audit: {
      surface: "ops",
      actor: { kind: "staff", id: "ops@localhost" },
      action: "visit.cancel",
      subject: { kind: "appointment", id: VISIT },
      requestId: null,
    },
  };

  /** Both read the terms before either cancels, as two requests at the same moment do; then both cancel. */
  async function cancelledByBoth(deps: TestDependencies) {
    const visit = await changeableVisit(env.DB, PERSON, VISIT, NOW);
    if (visit === null) throw new Error("the visit should be changeable");
    const terms = await changeTerms({
      db: env.DB,
      visit,
      now: NOW,
      inForce: termsInForce(await readOpsInputs(env.DB, NOW), "service"),
    });
    const outcomes = await Promise.all([
      cancelVisit({ db: env.DB, deps, terms, now: NOW, options }),
      cancelVisit({
        db: env.DB,
        deps,
        terms: opsCancelTerms({ terms, onClientTerms: false }),
        now: NOW,
        options: { ...options, ops: byOps },
      }),
    ]);
    return outcomes.map((outcome) => outcome.kind).sort();
  }

  const restores = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first<{ n: number }>())?.n;

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("is cancelled once, refunded once and the client told once", async () => {
    const payments = createStubPayments();

    expect(await cancelledByBoth(fakeDependencies({ payments }))).toEqual(["cancelled", "not_changeable"]);

    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect((await changes()).results).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toHaveLength(1);
  });

  it("gives its credit back once", async () => {
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();

    expect(await cancelledByBoth(fakeDependencies())).toEqual(["cancelled", "not_changeable"]);

    expect(await restores()).toBe(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

describe("a visit cancelled, when something fails after it is cancelled", () => {
  const cancelFree = (deps: TestDependencies, database: D1Database = env.DB) =>
    call(
      PERSON,
      `/api/appointments/${VISIT}/cancel`,
      { method: "POST", body: { confirm: true, notice: "free" } },
      deps,
      database,
    );

  const settled = () =>
    env.DB.prepare("SELECT refund_settled_at FROM visit_changes WHERE appointment_id = ?1")
      .bind(VISIT)
      .first<{ refund_settled_at: string | null }>();

  /** The cron's cancel_refunds pass, `minutes` after NOW. */
  const refundPass = (deps: TestDependencies, minutes: number) =>
    settleOwedRefunds(env.DB, { ...deps, budget: createCallBudget(40), log: createLogger() }, at(minutes * 60));

  const queueThatRefuses = () => ({ ...fakeQueue(), send: () => Promise.reject(new Error("Queue send failed")) });

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("stays cancelled with its refund pending when D1 is lost once it is cancelled, and the job refunds once", async () => {
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });

    const done = await cancelFree(deps, failingAfterTheFirstBatch(env.DB));

    expect(done.status).toBe(202);
    expect(await done.json()).toMatchObject({ cancelled: true, refund_pending: true, refund: 200000 });
    expect((await visitOf(VISIT))?.status).toBe("cancelled");
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(await settled()).toEqual({ refund_settled_at: null });

    expect(await refundPass(deps, 5)).toBe(0);
    expect(await refundPass(deps, 11)).toBe(1);
    expect(payments.made.refunds).toHaveLength(1);
    expect(deps.alerts).toEqual([]);
    expect(await settled()).toEqual({ refund_settled_at: at(11 * 60).toISOString() });
    expect(await refundPass(deps, 16)).toBe(0);
  });

  it("leaves the job a refund Razorpay did not answer when ops could not be told", async () => {
    const silent = () => Promise.reject(new PaymentUnanswered("refund", new Error("The operation timed out.")));
    const failing = fakeDependencies({
      payments: { ...createStubPayments(), refund: silent },
      alertOnce: () => Promise.reject(new Error("D1_ERROR: Network connection lost.")),
    });

    const done = await cancelFree(failing);
    expect(done.status).toBe(202);
    expect((await visitOf(VISIT))?.status).toBe("cancelled");

    const payments = createStubPayments();
    const deps = fakeDependencies({ payments });
    expect(await refundPass(deps, 11)).toBe(1);
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("answers cancelled and refunded when the queue refuses the message, which waits for the sweeper", async () => {
    useMessageQueue(queueThatRefuses());
    const payments = createStubPayments();

    const done = await cancelFree(fakeDependencies({ payments }));

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, refund_pending: false });
    expect(payments.made.refunds).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "cancel_confirmation", subject_id: VISIT }]);
    expect(await settled()).toEqual({ refund_settled_at: NOW.toISOString() });
  });

  it("gives a credit back with the cancel itself, whatever fails after", async () => {
    await env.DB.prepare("DELETE FROM payments").run();
    await grantCredits(env.DB, { personId: PERSON, visits: 1, source: "referral", sourceId: "attr-1", now: NOW }).run();
    await redeemCredit(env.DB, PERSON, VISIT, NOW).run();
    useMessageQueue(queueThatRefuses());

    const done = await cancelFree(fakeDependencies(), failingAfterTheFirstBatch(env.DB));

    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ cancelled: true, credit: "restored", refund_pending: false });
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(1);
  });
});

describe("the cron's cancel_refunds job", () => {
  /** A cancel whose Worker stopped once the visit was cancelled, before its refund was settled. */
  const stoppedAfterCancelling = (visitStatus = "cancelled") =>
    env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = ?2 WHERE id = ?1").bind(VISIT, visitStatus),
      env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
           payment_id, created_at)
         VALUES (?1, ?2, ?3, 'cancelled', 'free', ?4, 200000, 0, ?5, ?6)`,
      ).bind(crypto.randomUUID(), VISIT, PERSON, THURSDAY_NOON, PAYMENT, NOW.toISOString()),
    ]);

  const job = CRON_JOBS.filter((each) => each.name === "cancel_refunds");
  const run = (deps: TestDependencies) =>
    runCronJobs(job, { env: { ...env, MESSAGE_QUEUE: messageQueue }, deps, config: LOCAL_CONFIG, log: createLogger() });

  beforeEach(async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
  });

  it("refunds once a cancel whose Worker stopped before its refund", async () => {
    await stoppedAfterCancelling();
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments, now: () => at(11 * 60) });

    expect(await run(deps)).toEqual([{ job: "cancel_refunds", ok: true }]);
    expect(await run(deps)).toEqual([{ job: "cancel_refunds", ok: true }]);

    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(deps.alerts).toEqual([]);
  });

  it("tells ops to look in Razorpay before refunding by hand, since the refund it refuses may have been made", async () => {
    await stoppedAfterCancelling();
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => {
        asked += 1;
        return Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR: the payment has been fully refunded"));
      },
    };
    const deps = fakeDependencies({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);
    await run(deps);

    expect(asked).toBe(2);
    expect(deps.alerts).toEqual([
      `Razorpay did not answer the refund of Rs. 2,000 for visit ${VISIT}, cancelled by the client (payment ` +
        "pay_visit), so it may have been made. Look at the payment in Razorpay, and refund it by hand only if no " +
        `refund of Rs. 2,000 is there. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  it("names ops in the alert for a cancel ops made in the console", async () => {
    await stoppedAfterCancelling();
    await env.DB.prepare("UPDATE visit_changes SET cancelled_by = 'ops@localhost', ops_terms = 'free'").run();
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR: the payment has been fully refunded")),
    };
    const deps = fakeDependencies({ payments: refusing, now: () => at(11 * 60) });

    await run(deps);

    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toContain(`Rs. 2,000 for visit ${VISIT}, cancelled by ops (payment pay_visit)`);
  });

  it("leaves alone a claim whose visit was never cancelled, and one the Worker before it refunded", async () => {
    await stoppedAfterCancelling("scheduled");
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments, now: () => at(11 * 60) });
    await run(deps);
    expect(payments.made.refunds).toEqual([]);

    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(VISIT),
      env.DB.prepare("UPDATE visit_changes SET razorpay_refund_id = 'rfnd_before' WHERE appointment_id = ?1").bind(
        VISIT,
      ),
    ]);
    await run(deps);
    expect(payments.made.refunds).toEqual([]);
  });
});

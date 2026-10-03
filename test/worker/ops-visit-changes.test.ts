// Ops cancelling a visit from the console, and closing one by hand whose technician's phone was lost
// (src/routes/ops-visits.ts). A cancel is free to the client unless ops apply the client's own late terms, with a
// reason. NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { FieldRecord } from "../../src/config/field-record.ts";
import { creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { createStubFsm, EMPTY_FSM, type FsmProvider } from "../../src/providers/fsm.ts";
import { createStubPayments, type PaymentsProvider, type StubPayments } from "../../src/providers/payments.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  markDatabase,
  NOW,
  PROVIDERS_FOR,
  request,
  savedAddress,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";

/** Tuesday 22 September, morning: inside the 24 hours' notice from NOW. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";
/** Monday 21 September, 9 am in India: this morning, before NOW. */
const THIS_MORNING = "2026-09-21T03:30:00.000Z";

const REASON = "Client phoned: his father is unwell";

let payments: StubPayments;
let messages: ReturnType<typeof fakeQueue>;

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  payments = createStubPayments();
  messages = fakeQueue();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await savedAddress(PERSON);
});

/** FSM's catalogue, for the work order FSM's path cancels. */
const fsmWorld = () =>
  createStubFsm({ ...EMPTY_FSM, items: [{ id: "item-service", name: "Service visit", type: "Service", price: null }] });

/**
 * A visit with Imran, as each record of field work books it: FSM's with its work order, or our own with its own ID
 * in fsm_id and no work order.
 */
async function visit(record: FieldRecord, type: string, start: string, status = "scheduled") {
  const minutes = type === "first_fit" ? 180 : 90;
  const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();
  const fsmId = record === "fsm" ? "fsm-visit-1" : VISIT;
  const workOrder = record === "fsm" ? "fsm-order-1" : null;
  const fsmStatus = record === "fsm" ? "Scheduled" : null;
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
       window_end, technician_id, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 't1', ?10, ?10)`,
  )
    .bind(VISIT, fsmId, workOrder, PERSON, type, status, fsmStatus, start, end, NOW.toISOString())
    .run();
}

/** What the client paid for the visit, by UPI. */
const paid = (amount: number) =>
  env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_visit', ?4, 'INR', 'upi', 'captured', ?5, ?5, ?5)`,
  )
    .bind(PAYMENT, PERSON, VISIT, amount, "2026-09-20T06:30:00.000Z")
    .run();

/** The visit paid with one of three visit credits from an invite. */
async function paidWithCredit() {
  await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "referral", sourceId: "attr-1", now: NOW }).run();
  await redeemCredit(env.DB, PERSON, VISIT, NOW).run();
}

interface Vendors {
  readonly record: FieldRecord;
  readonly fsm?: FsmProvider;
  readonly payments?: PaymentsProvider;
}

function opsApp(vendors: Vendors) {
  const deps = fakeDependencies({
    payments: vendors.payments ?? payments,
    fsm: vendors.fsm ?? (vendors.record === "ours" ? fsmSwitchedOff() : fsmWorld()),
  });
  return { deps, app: appFor("local", deps, {}, "ops", PROVIDERS_FOR[vendors.record]) };
}

const post = (vendors: Vendors, path: string, body: object) =>
  request(
    opsApp(vendors).app,
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    { MESSAGE_QUEUE: messages },
  );

const cancel = (vendors: Vendors, body: object) => post(vendors, `/api/visits/${VISIT}/cancel`, body);
const close = (vendors: Vendors, body: object) => post(vendors, `/api/visits/${VISIT}/close`, body);

const statusOf = async () =>
  (await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(VISIT).first<{ status: string }>())
    ?.status;

const changes = async () =>
  (
    await env.DB.prepare(
      `SELECT kind, notice, refund_amount, kept_amount, payment_id, cancelled_by, cancel_reason, ops_terms
       FROM visit_changes`,
    ).all()
  ).results;

const auditOf = async (action: string) => {
  const row = await env.DB.prepare("SELECT actor, subject_kind, subject_id, detail FROM audit_log WHERE action = ?1")
    .bind(action)
    .first<{ actor: string; subject_kind: string; subject_id: string; detail: string }>();
  return row === null ? null : { ...row, detail: JSON.parse(row.detail) as unknown };
};

const queuedMessages = async () =>
  (await env.DB.prepare("SELECT kind, subject_id FROM outbound_messages").all()).results;

const restores = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first<{ n: number }>())?.n;

describe("POST /api/visits/:id/cancel: what it gives back", () => {
  it("shows what a cancel gives back free to the client, and on the client's own late terms, and changes nothing", async () => {
    await visit("ours", "service", TUESDAY_MORNING);
    await paid(200000);

    const answer = await cancel({ record: "ours" }, { confirm: false });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      visit_id: VISIT,
      type: "service",
      notice: "late",
      notice_hours: 24,
      paid: 200000,
      destination: "upi",
      free: { refund: 200000, kept: 0, credit: null },
      client_terms: { refund: 0, kept: 200000, credit: null },
      cancelled: false,
    });
    expect(await statusOf()).toBe("scheduled");
    expect(await changes()).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });

  it("shows a first fit's late fee kept on the client's terms, and the rest refunded", async () => {
    await visit("ours", "first_fit", TUESDAY_MORNING);
    await paid(3000000);

    // The price book's late fee for a first fit on the 22nd is Rs. 4,000.
    const shown = await (await cancel({ record: "ours" }, { confirm: false })).json();
    expect(shown).toMatchObject({
      free: { refund: 3000000, kept: 0 },
      client_terms: { refund: 2600000, kept: 400000 },
    });
  });
});

describe.each(["fsm", "ours"] as const)("POST /api/visits/:id/cancel, with %s holding the record", (record) => {
  it("cancels free to the client by default: the whole payment refunded, the client told, and audited", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paid(200000);
    const fsm = fsmWorld();
    const vendors = { record, ...(record === "fsm" ? { fsm } : {}) };

    const answer = await cancel(vendors, { confirm: true, notice: "late", reason: REASON });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ cancelled: true, free: { refund: 200000, kept: 0 } });

    expect(await statusOf()).toBe("cancelled");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_visit", amount: 200000 }]);
    expect(await changes()).toEqual([
      {
        kind: "cancelled",
        notice: "late",
        refund_amount: 200000,
        kept_amount: 0,
        payment_id: PAYMENT,
        cancelled_by: "ops@localhost",
        cancel_reason: REASON,
        ops_terms: "free",
      },
    ]);
    expect(await queuedMessages()).toEqual([{ kind: "visit_cancelled", subject_id: VISIT }]);
    expect(messages.sent).toHaveLength(1);
    // The log names the cancel, never what ops wrote.
    expect(await auditOf("visit.cancel")).toEqual({
      actor: "ops@localhost",
      subject_kind: "appointment",
      subject_id: VISIT,
      detail: { terms: "free", refund: 200000, kept: 0 },
    });
    const cancelledInFsm = record === "fsm" ? [{ workOrderId: "fsm-order-1", note: expect.any(String) as string }] : [];
    expect(fsm.made.cancelled).toEqual(cancelledInFsm);
  });

  it("keeps what the client's late terms keep, when ops apply them", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paid(200000);

    const answer = await cancel(
      { record },
      { confirm: true, notice: "late", on_client_terms: true, reason: "Cancelled an hour before; no reason given" },
    );
    expect(answer.status).toBe(200);
    expect(await statusOf()).toBe("cancelled");
    expect(payments.made.refunds).toEqual([]);
    expect(await changes()).toMatchObject([{ refund_amount: 0, kept_amount: 200000, ops_terms: "client" }]);
    expect(await auditOf("visit.cancel")).toMatchObject({ detail: { terms: "client", refund: 0, kept: 200000 } });
  });

  it("gives a credit back free to the client", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paidWithCredit();

    const shown = await (await cancel({ record }, { confirm: false })).json();
    expect(shown).toMatchObject({ free: { credit: "restored" }, client_terms: { credit: "lost" } });
    await cancel({ record }, { confirm: true, notice: "late", reason: REASON });
    expect(await restores()).toBe(1);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(3);
  });

  it("spends the credit on the client's late terms", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paidWithCredit();

    await cancel({ record }, { confirm: true, notice: "late", on_client_terms: true, reason: REASON });
    expect(await statusOf()).toBe("cancelled");
    expect(await restores()).toBe(0);
    expect((await creditBalance(env.DB, PERSON, NOW)).visits).toBe(2);
  });

  it("cancels once: a second cancel is refused, and nothing is refunded twice", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paid(200000);

    await cancel({ record }, { confirm: true, notice: "late", reason: REASON });
    const again = await cancel({ record }, { confirm: true, notice: "late", reason: REASON });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "not_changeable" } });
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("never cancels a visit the technician has begun", async () => {
    await visit(record, "service", TUESDAY_MORNING);
    await paid(200000);
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES ('event-1', ?1, 'event-checkin-01', 't1', 'check_in', '{}', ?2, ?2, ?2)`,
    )
      .bind(VISIT, NOW.toISOString())
      .run();

    const answer = await cancel({ record }, { confirm: true, notice: "late", reason: REASON });
    expect(answer.status).toBe(409);
    expect(await statusOf()).toBe("scheduled");
    expect(payments.made.refunds).toEqual([]);
  });
});

describe("POST /api/visits/:id/cancel: what it refuses", () => {
  it("refuses a cancel with no reason, and changes nothing", async () => {
    await visit("ours", "service", TUESDAY_MORNING);
    await paid(200000);

    for (const reason of [undefined, "   "]) {
      const answer = await cancel({ record: "ours" }, { confirm: true, notice: "late", reason });
      expect(answer.status).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    }
    expect(await statusOf()).toBe("scheduled");
  });

  it("refuses to cancel on a notice ops were not shown", async () => {
    await visit("ours", "service", TUESDAY_MORNING);
    await paid(200000);

    const answer = await cancel({ record: "ours" }, { confirm: true, notice: "free", reason: REASON });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "terms_changed" } });
    expect(await statusOf()).toBe("scheduled");
  });

  it("refuses a visit that has passed or is no client's", async () => {
    await visit("ours", "service", THIS_MORNING);
    expect((await cancel({ record: "ours" }, { confirm: false })).status).toBe(409);
    await env.DB.prepare("UPDATE appointments SET window_start = ?2, person_id = NULL WHERE id = ?1")
      .bind(VISIT, TUESDAY_MORNING)
      .run();
    expect((await cancel({ record: "ours" }, { confirm: false })).status).toBe(409);
  });

  it("changes nothing when FSM does not answer, so ops can try again", async () => {
    await visit("fsm", "service", TUESDAY_MORNING);
    await paid(200000);
    const failing: FsmProvider = { ...fsmWorld(), cancelVisit: () => Promise.reject(new Error("Zoho 503")) };

    const answer = await cancel({ record: "fsm", fsm: failing }, { confirm: true, notice: "late", reason: REASON });
    expect(answer.status).toBe(503);
    expect(await statusOf()).toBe("scheduled");
    expect(await changes()).toEqual([]);
    expect(payments.made.refunds).toEqual([]);
  });

  it("tells ops the refund Razorpay refused is theirs to make by hand, once", async () => {
    await visit("ours", "service", TUESDAY_MORNING);
    await paid(200000);
    const refusing: PaymentsProvider = { ...payments, refund: () => Promise.reject(new Error("Razorpay 502")) };
    const { deps, app } = opsApp({ record: "ours", payments: refusing });

    const answer = await request(
      app,
      `/api/visits/${VISIT}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ confirm: true, notice: "late", reason: REASON }),
      },
      { MESSAGE_QUEUE: messages },
    );
    expect(answer.status).toBe(200);
    expect(await statusOf()).toBe("cancelled");
    expect(deps.alerts).toEqual([
      `The refund of Rs. 2000 for visit ${VISIT}, cancelled by ops, failed (Razorpay payment pay_visit). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}`,
    ]);
  });
});

/** "09:20" on Monday 21 September, in India, as an instant. */
const today = (time: string) => new Date(`2026-09-21T${time}:00+05:30`).toISOString();

const visitsRow = () =>
  env.DB.prepare(
    `SELECT outcome, started_at, ended_at, duration_minutes, partial_reason, closed_by, close_reason
     FROM visits WHERE appointment_id = ?1`,
  )
    .bind(VISIT)
    .first();

describe("POST /api/visits/:id/close", () => {
  it("closes a visit as done by hand: completed, its visit row with the times, who closed it and why, and audited", async () => {
    await visit("ours", "service", THIS_MORNING);
    const reason = "Imran's phone was stolen; the client confirmed the visit by phone";

    const answer = await close(
      { record: "ours" },
      { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason },
    );
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ visit_id: VISIT, status: "completed", duration_minutes: 90 });
    expect(await statusOf()).toBe("completed");
    expect(await visitsRow()).toEqual({
      outcome: "done",
      started_at: today("09:20"),
      ended_at: today("10:50"),
      duration_minutes: 90,
      partial_reason: null,
      closed_by: "ops@localhost",
      close_reason: reason,
    });
    expect(await auditOf("visit.close")).toEqual({
      actor: "ops@localhost",
      subject_kind: "appointment",
      subject_id: VISIT,
      detail: { outcome: "done" },
    });
  });

  it("closes a visit as partly done, which leaves it terminated and waiting for a follow-up", async () => {
    await visit("ours", "service", THIS_MORNING, "in_progress");
    const reason = "Phone lost mid-visit; Imran says the client had to leave";

    const answer = await close(
      { record: "ours" },
      { outcome: "partial", started_at: today("09:20"), ended_at: today("10:00"), reason },
    );
    expect(answer.status).toBe(200);
    expect(await statusOf()).toBe("terminated");
    expect(await visitsRow()).toMatchObject({ outcome: "partial", duration_minutes: 40, close_reason: reason });
    const waiting = (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.filter(
      (task) => task.group === "partial_visit",
    );
    expect(waiting).toMatchObject([{ id: VISIT, detail: reason }]);
  });

  it("closes a visit once: a second close is refused, and the first stands", async () => {
    await visit("ours", "service", THIS_MORNING);
    const first = { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: "Phone lost" };
    expect((await close({ record: "ours" }, first)).status).toBe(200);

    const second = await close(
      { record: "ours" },
      { outcome: "partial", started_at: today("09:30"), ended_at: today("10:00"), reason: "Again" },
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "already_closed" } });
    expect(await visitsRow()).toMatchObject({ outcome: "done", close_reason: "Phone lost" });
  });

  it("refuses a visit the technician's phone already closed, and one that was cancelled", async () => {
    await visit("ours", "service", THIS_MORNING);
    await env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES ('event-1', ?1, 'event-outcome-01', 't1', 'outcome', '{"outcome":"done"}', ?2, ?2, ?2)`,
    )
      .bind(VISIT, NOW.toISOString())
      .run();
    const body = { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: "Phone lost" };

    expect(await (await close({ record: "ours" }, body)).json()).toMatchObject({ error: { code: "already_closed" } });
    await env.DB.prepare("DELETE FROM job_events").run();
    await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(VISIT).run();
    expect(await (await close({ record: "ours" }, body)).json()).toMatchObject({ error: { code: "already_closed" } });
    expect(await visitsRow()).toBeNull();
  });

  it("refuses a visit whose time has not come", async () => {
    await visit("ours", "service", TUESDAY_MORNING);
    const answer = await close(
      { record: "ours" },
      { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: "Phone lost" },
    );
    expect(answer.status).toBe(425);
    expect(await answer.json()).toMatchObject({ error: { code: "too_early_to_close" } });
  });

  it("refuses times that end before they start, end after now, or fall on another day than the visit's", async () => {
    await visit("ours", "service", THIS_MORNING);
    const sent = [
      { started_at: today("10:50"), ended_at: today("09:20") },
      { started_at: today("11:00"), ended_at: today("12:30") },
      { started_at: "2026-09-20T04:00:00.000Z", ended_at: "2026-09-20T05:00:00.000Z" },
    ];
    for (const times of sent) {
      const answer = await close({ record: "ours" }, { outcome: "done", ...times, reason: "Phone lost" });
      expect(answer.status).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    const unreasoned = await close(
      { record: "ours" },
      { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: " " },
    );
    expect(await unreasoned.json()).toMatchObject({ error: { code: "invalid_request", fields: ["reason"] } });
    expect(await statusOf()).toBe("scheduled");
  });

  it("leaves a visit to FSM while FSM holds the record", async () => {
    await visit("fsm", "service", THIS_MORNING);
    const answer = await close(
      { record: "fsm" },
      { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: "Phone lost" },
    );
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "managed_in_fsm" } });
    expect(await statusOf()).toBe("scheduled");
  });

  it("answers not_found for no such visit", async () => {
    const answer = await close(
      { record: "ours" },
      { outcome: "done", started_at: today("09:20"), ended_at: today("10:50"), reason: "Phone lost" },
    );
    expect(answer.status).toBe(404);
  });
});

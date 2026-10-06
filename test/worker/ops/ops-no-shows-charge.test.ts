// The no-show queue ops rule on (src/routes/ops/no-shows.ts).
// NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real
// person, number or address.
//
// A case is evidence a client may be charged on, so it has to say whose visit
// it was, when it was booked for, both clocks the check-in was read by, and
// whether the reminder ever went at all; and a ruling has to carry its reason.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { decideNoShow } from "../../../src/domain/no-shows/no-shows.ts";
import { WAIVER_GIVES_BACK, type Waiver } from "../../../src/policy/no-show.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, VISIT, CASE, TECHNICIAN, COMMITTED_TERMS } from "./ops-no-shows-fixtures.ts";

let ops: App;

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', '+919810000001', 'Rohit Malhotra')",
    ).bind(PERSON),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?2)",
    ).bind(TECHNICIAN, NOW.toISOString()),
    // Booked for 9 am on Saturday the 19th; he checked in at 2:08 pm by his phone, which reached us at 2:29.
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-1', ?2, 'service', 'terminated', 'Terminated', '2026-09-19T03:30:00.000Z',
         '2026-09-19T06:30:00.000Z', ?3, ?4, ?4)`,
    ).bind(VISIT, PERSON, TECHNICIAN, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, claimed_at, lat, lng, distance_m, radius_m, passed,
         created_at)
       VALUES ('checkin-1', ?1, ?2, '2026-09-19T08:38:59.000Z', '2026-09-19T08:38:59.000Z', 28.4, 77.0, 40, 200, 1,
         '2026-09-19T08:59:00.037Z')`,
    ).bind(VISIT, TECHNICIAN),
    env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
         created_at)
       VALUES (?1, 'checkin-1', ?2, '2026-09-19T08:38:59.000Z', '2026-09-19T09:14:00.037Z',
         '2026-09-19T09:14:00.067Z', 'undecided', '2026-09-19T09:14:00.067Z')`,
    ).bind(CASE, VISIT),
  ]);
});

/**
 * A no-show costs, to begin with, what a late cancellation of the same visit costs, set in the console apart from it;
 * a booking keeps the
 * charge it was sold under (docs/decisions/0088-every-policy-in-the-console.md).
 */
describe("what charging a no-show costs the client", () => {
  const as = (type: string) =>
    env.DB.prepare("UPDATE appointments SET type = ?1 WHERE id = ?2").bind(type, VISIT).run();

  const paid = (amount: number) =>
    env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
         status, captured_at, created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0841', ?1, ?2, 'pay_visit', ?3, 'INR', 'upi', 'captured', ?4, ?4, ?4)`,
    )
      .bind(PERSON, VISIT, amount, NOW.toISOString())
      .run();

  async function onCredit(grantExpires = "2027-09-21T06:30:00.000Z") {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
         VALUES ('grant-1', ?1, 'grant', 3, 'referral', 'referral-1', ?2, ?3)`,
      ).bind(PERSON, grantExpires, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
         VALUES ('redeem-1', ?1, 'redeem', -1, 'grant-1', 'appointment', ?2, ?3)`,
      ).bind(PERSON, VISIT, NOW.toISOString()),
    ]);
  }

  /** The hold that sold the visit, with the no-show charge and the late fee it kept. */
  const soldWith = (charge: string, lateFeeExGst: number | null = null) =>
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, appointment_id, no_show_charge,
         late_fee_ex_gst, late_fee_gst_percent)
       SELECT 'hold-1', ?1, type, '2026-09-19', 'morning', ?2, 0, 0, 0, 0, 'booked', ?3, ?3, ?3, id, ?4, ?5, ?6
       FROM appointments WHERE id = ?7`,
    )
      .bind(
        PERSON,
        TECHNICIAN,
        "2026-09-15T06:30:00.000Z",
        charge,
        lateFeeExGst,
        lateFeeExGst === null ? null : 0,
        VISIT,
      )
      .run();

  const opsSetNoShowCharge = async (service: string) => {
    await env.DB.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('no_show_charge', ?1, 'ops', ?2)`,
    )
      .bind(
        JSON.stringify({ consultation: "nothing", first_fit: "late_fee", replacement: "late_fee", service }),
        NOW.toISOString(),
      )
      .run();
  };

  async function charge(payments = createStubPayments(), deps = fakeDependencies({ payments })) {
    const app = appFor("local", deps, {}, "ops");
    const answer = await request(
      app,
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "charged", reason: "Nobody came to the door" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(200);
    return payments;
  }

  const recorded = () => env.DB.prepare("SELECT charge, kept_amount, refund_amount FROM no_show_cases").first();
  const preview = () => request(ops, `/api/no-shows/${CASE}/charge`);
  const restores = async () =>
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'restore'").first<{ n: number }>())?.n;

  it("keeps a first fit's late fee from its payment, refunds the rest, and records both on the no-show", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);

    const payments = await charge();

    expect(payments.made.refunds).toEqual([expect.objectContaining({ paymentId: "pay_visit", amount: 2600000 })]);
    expect(await recorded()).toEqual({ charge: "late_fee", kept_amount: 400000, refund_amount: 2600000 });
  });

  it("keeps a replacement's late fee on its day, where no hold sold it", async () => {
    await as("replacement");
    await paid(1575000);

    const payments = await charge();

    // Rs. 3,000 and 5% GST, the price book's before 22 September.
    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 1260000 })]);
    expect(await recorded()).toEqual({ charge: "late_fee", kept_amount: 315000, refund_amount: 1260000 });
  });

  // The charge was once asked about as "Charge Rohit Malhotra for the visit of Sat 19 Sep?", with no figure.
  it("says before a charge what it will keep and refund, as the charge then does", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);
    expect(await (await preview()).json()).toEqual({ paid: 3000000, kept: 400000, credit_kept: false });

    await charge();
    expect(await recorded()).toEqual({ charge: "late_fee", kept_amount: 400000, refund_amount: 2600000 });
    // Ruled on, there is nothing left to ask about.
    expect((await preview()).status).toBe(404);
  });

  it("says before a charge whether it keeps the credit the visit was paid with", async () => {
    await onCredit();
    expect(await (await preview()).json()).toEqual({ paid: 0, kept: 0, credit_kept: true });
    // Sold to cost nothing if missed, so the credit goes back.
    await soldWith("nothing");
    expect(await (await preview()).json()).toEqual({ paid: 0, kept: 0, credit_kept: false });
  });

  it("keeps a paid service visit whole", async () => {
    await paid(200000);
    const payments = await charge();
    expect(payments.made.refunds).toEqual([]);
    expect(await recorded()).toEqual({ charge: "visit", kept_amount: 200000, refund_amount: 0 });
  });

  it("spends the credit a service visit was paid with", async () => {
    await onCredit();
    await charge();
    expect(await restores()).toBe(0);
    expect(await recorded()).toEqual({ charge: "visit", kept_amount: 0, refund_amount: 0 });
  });

  it("charges what the booking was sold under, whatever ops have set since", async () => {
    await paid(200000);
    await onCredit();
    await soldWith("nothing");
    await opsSetNoShowCharge("visit");

    const payments = await charge();

    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 200000 })]);
    expect(await restores()).toBe(1);
    expect(await recorded()).toEqual({ charge: "nothing", kept_amount: 0, refund_amount: 200000 });
  });

  // A consultation and fit in one visit holds no payment, and is sold to cost nothing if missed, still to be
  // confirmed (open point 90; docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
  it("charges nothing for a consultation and fit in one visit, which was sold so", async () => {
    await as("first_fit");
    await env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(VISIT).run();
    await soldWith("nothing");
    await opsSetNoShowCharge("visit");

    const payments = await charge();

    expect(payments.made.refunds).toEqual([]);
    expect(await recorded()).toEqual({ charge: "nothing", kept_amount: 0, refund_amount: 0 });
  });

  // The credit comes back only to a grant that can still take it (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  it("tells ops once when a charge of nothing finds the credit's grant clawed back", async () => {
    await onCredit();
    await soldWith("nothing");
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('clawback-1', ?1, 'clawback', -2, 'grant-1', 'referral', 'referral-1', ?2)`,
    )
      .bind(PERSON, "2026-09-20T06:30:00.000Z")
      .run();
    const deps = fakeDependencies();

    await charge(createStubPayments(), deps);

    expect(await restores()).toBe(0);
    expect(deps.alerts).toEqual([
      `The visit credit for visit ${VISIT}, a no-show charged, could not come back: its grant has expired or been ` +
        "withdrawn. The client is told so; settle it with them by hand if they are owed one. " +
        `http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
  });

  it("tells ops once when a waiver finds the credit's grant expired", async () => {
    await onCredit("2026-09-20T18:30:00.000Z");
    const deps = fakeDependencies();

    const answer = await request(
      appFor("local", deps, {}, "ops"),
      `/api/no-shows/${CASE}/decision`,
      {
        method: "POST",
        headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "waived", reason: "The lift was out" }),
      },
      { MESSAGE_QUEUE: fakeQueue() },
    );

    expect(answer.status).toBe(200);
    expect(await restores()).toBe(0);
    expect(await env.DB.prepare("SELECT key FROM alerts").all()).toMatchObject({
      results: [{ key: `no_show_credit_not_back:waived:${VISIT}` }],
    });
  });

  it("charges a visit no hold sold what ops set a no-show to cost now", async () => {
    await paid(200000);
    await opsSetNoShowCharge("nothing");
    const payments = await charge();
    expect(payments.made.refunds).toEqual([expect.objectContaining({ amount: 200000 })]);
  });

  it("tells ops once, with the visit and the payment, when Razorpay refuses the balance", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);
    const payments = { ...createStubPayments(), refund: () => Promise.reject(new Error("Razorpay 502")) };
    const deps = fakeDependencies({ payments });

    await charge(createStubPayments(), deps);

    expect(deps.alerts).toEqual([
      `The refund of Rs. 26,000 for visit ${VISIT}, a no-show charged, failed (Razorpay payment pay_visit). ` +
        `Refund it by hand in Razorpay, once. http://ops.localhost:4323/clients/${PERSON}/payments`,
    ]);
    // The charge stands: the ruling is recorded whatever Razorpay says.
    expect(await recorded()).toMatchObject({ kept_amount: 400000 });
  });

  it("gives back nothing twice when two rulings meet", async () => {
    await as("first_fit");
    await paid(3000000);
    await soldWith("late_fee", 400000);
    const ruling = {
      caseId: CASE,
      decision: "charged" as const,
      reason: "Nobody came to the door",
      actor: "ops@localhost",
      audit: {
        surface: "ops" as const,
        actor: { kind: "staff" as const, id: "ops@localhost" },
        action: "no_show.decide" as const,
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision: "charged" },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver: WAIVER_GIVES_BACK,
    };

    const both = await Promise.all([decideNoShow(env.DB, ruling), decideNoShow(env.DB, ruling)]);

    expect(both.filter((ruled) => ruled?.refund !== null && ruled !== null)).toHaveLength(1);
  });

  // The ruling that loses writes nothing at all: not the credit it would give back, not the client's message, not
  // its audit entry. Before the ruling's ID guarded them, all three went in beside the ruling that stood.
  describe("when a charge and a waiver meet", () => {
    const ruling = (decision: "charged" | "waived", waiver: Waiver) => ({
      caseId: CASE,
      decision,
      reason: "Nobody came to the door",
      actor: "ops@localhost",
      audit: {
        surface: "ops" as const,
        actor: { kind: "staff" as const, id: "ops@localhost" },
        action: "no_show.decide" as const,
        subject: { kind: "no_show_case", id: CASE },
        requestId: "request-1",
        detail: { decision },
      },
      now: NOW,
      terms: COMMITTED_TERMS,
      waiver,
    });

    /** What the race left: the ruling that stands, and what went in beside it. */
    async function afterTheRace() {
      const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;
      return {
        stands: (await env.DB.prepare("SELECT decision FROM no_show_cases").first<{ decision: string }>())?.decision,
        restores: await restores(),
        messages: await count("SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'no_show_decided'"),
        audited: (await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'no_show.decide'").all()).results,
      };
    }

    it("gives the credit back only if the charge of nothing stands, against a waiver that keeps it", async () => {
      await onCredit();
      await soldWith("nothing");

      const both = await Promise.all([
        decideNoShow(env.DB, ruling("waived", { payment: "kept", credit: "spent" })),
        decideNoShow(env.DB, ruling("charged", WAIVER_GIVES_BACK)),
      ]);

      expect(both.filter((ruled) => ruled !== null)).toHaveLength(1);
      const { stands, restores: restored, messages, audited } = await afterTheRace();
      expect(restored).toBe(stands === "charged" ? 1 : 0);
      expect(messages).toBe(1);
      expect(audited).toEqual([{ detail: JSON.stringify({ decision: stands }) }]);
    });

    it("gives the credit back only if the waiver stands, against a charge that spends it", async () => {
      await onCredit();
      await soldWith("visit");

      const both = await Promise.all([
        decideNoShow(env.DB, ruling("charged", WAIVER_GIVES_BACK)),
        decideNoShow(env.DB, ruling("waived", WAIVER_GIVES_BACK)),
      ]);

      expect(both.filter((ruled) => ruled !== null)).toHaveLength(1);
      const { stands, restores: restored, messages, audited } = await afterTheRace();
      expect(restored).toBe(stands === "waived" ? 1 : 0);
      expect(messages).toBe(1);
      expect(audited).toEqual([{ detail: JSON.stringify({ decision: stands }) }]);
    });
  });
});

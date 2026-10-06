// A discount code entered on a booking (docs/decisions/0108-discount-codes.md): by the client at the app's pay step,
// on the site's form for a consultation and fit in one visit, and by the technician before the visit's payment link.
// Each takes the code off before GST, and the order, the link and the payment carry what is left. NOW is Monday 21
// September 2026, 12 noon in India; staging's book has a service visit at Rs. 2,000 and a first fit at Rs. 30,000,
// with no GST, from the 22nd. Every name, number and code here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { grantCredits } from "../../../src/domain/money/credits.ts";
import { removeFromVisit } from "../../../src/domain/money/discount-code-visits.ts";
import { listCodes } from "../../../src/domain/money/discount-codes.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, markDatabase, NOW } from "../helpers.ts";
import { JOB, working } from "../job-fixtures.ts";
import { PERSON, make, cookies, uses } from "./discount-code-entries-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
});

describe("the technician, before a one visit's payment link", () => {
  const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };
  const A_PIECE = { piece_code: "MM-NAT-4417-A", base: "Lace", supplier_lot: "L-22" };

  async function oneVisit(payments = createStubPayments()) {
    const job = await working("first_fit", { payments });
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET one_visit = 'booked' WHERE id = ?1").bind(JOB),
      env.DB.prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
      ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
         VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
      ).bind(NATURAL.tier, NATURAL.amount),
    ]);
    return job;
  }

  /** Works the one visit up to its outcome, the client's choice first, as its piece step's body says. */
  const workedWith = async (job: Awaited<ReturnType<typeof oneVisit>>, piece: object) => {
    await job.workTo("piece");
    await job.post(`/api/tech/jobs/${JOB}/piece`, piece, "event-piece-01");
    await job.post(`/api/tech/jobs/${JOB}/checklist`, { done: [] }, "event-checklist-01");
    await job.post(`/api/tech/jobs/${JOB}/consumables`, { items: [] }, "event-consumables-01");
    await job.post(`/api/tech/jobs/${JOB}/photos`, { phase: "after" }, "event-afterphotos-01");
  };
  const fitted = (job: Awaited<ReturnType<typeof oneVisit>>) => workedWith(job, { ...A_PIECE, product: NATURAL.tier });

  it("takes the code off the product's price in the link, and no amount reaches the phone", async () => {
    await make();
    const payments = createStubPayments();
    const job = await oneVisit(payments);
    const entered = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "tenpc" }, "unused");
    expect(entered.status).toBe(200);
    expect(await entered.json()).toEqual({ code: "TENPC" });

    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    expect(payments.made.links).toMatchObject([{ amount: 4_050_000 }]);
    const link = await env.DB.prepare("SELECT amount, amount_ex_gst FROM payment_links").first();
    expect(link).toEqual({ amount: 4_050_000, amount_ex_gst: 4_050_000 });
    expect((await uses()).results).toEqual([
      { hold_id: null, appointment_id: JOB, amount_off: 450_000, given_by: "technician", removed: 0 },
    ]);
  });

  it("is refused once the link is made, and on a visit paid ahead", async () => {
    await make();
    const job = await oneVisit();
    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    const late = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: "price_settled" } });

    await env.DB.prepare("UPDATE appointments SET one_visit = NULL WHERE id = ?1").bind(JOB).run();
    const prepaid = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(await prepaid.json()).toMatchObject({ error: { code: "price_settled" } });
  });

  it("still takes a code on a first fit while the client holds credits, which pay only service visits", async () => {
    await make();
    const job = await oneVisit();
    await grantCredits(env.DB, { personId: PERSON, visits: 3, source: "ops", sourceId: "o1", now: NOW }).run();
    const entered = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    expect(entered.status).toBe(200);
  });

  // Review of #177: a ₹0 link, which Razorpay refuses, left ops a task that never closed.
  it("settles a one visit a code makes free: no link, nothing owed, and the client told on WhatsApp", async () => {
    await make({ code: "ALLFREE", kind: "amount", value: NATURAL.amount });
    const payments = createStubPayments();
    const job = await oneVisit(payments);
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "ALLFREE" }, "unused");
    await fitted(job);
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");

    expect(payments.made.links).toEqual([]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM payment_links").first("n")).toBe(0);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "payment_owed")).toEqual([]);
    expect(job.deps.alerts).toEqual([]);
    const told = await env.DB.prepare("SELECT kind FROM outbound_messages WHERE subject_id = ?1 ORDER BY kind")
      .bind(JOB)
      .all();
    // The other is the arrival notice of the technician's check-in.
    expect(told.results).toEqual([{ kind: "arrival_notice" }, { kind: "nothing_to_pay" }]);
    expect((await uses()).results).toMatchObject([{ amount_off: NATURAL.amount }]);
    // Owing nothing, the fit settles an invited friend's referral as a payment would.
    const visit = await env.DB.prepare("SELECT nothing_owed_at FROM appointments WHERE id = ?1").bind(JOB).first();
    expect(visit).toEqual({ nothing_owed_at: NOW.toISOString() });
    // The close settled its price, so the code stays on it, as on a visit paid for.
    const ops = { kind: "ops", actor: { kind: "staff", id: "ops@localhost" } } as const;
    expect(await removeFromVisit(env.DB, { visitId: JOB, by: ops, requestId: "r" }, NOW)).toBe("price_settled");
  });

  it("gives the code back when the client decides against the fit, and nothing is sold", async () => {
    await make({ code: "UNQ5", maxUses: 1 });
    const job = await oneVisit();
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "UNQ5" }, "unused");
    await workedWith(job, { declined: true });
    await job.post(`/api/tech/jobs/${JOB}/outcome`, { outcome: "done" }, "event-outcome-01");
    const use = await env.DB.prepare("SELECT removed_by, removed_by_id FROM discount_code_uses").first();
    expect(use).toEqual({ removed_by: "system", removed_by_id: "declined" });
    const [code] = await listCodes(env.DB, NOW, "UNQ5");
    expect(code?.uses).toBe(0);
  });

  // The technician learnt a code was on the visit only by typing one ("This visit already has a code.").
  it("puts the code already on a one visit on its card, and who gave it, never what it takes off", async () => {
    await make();
    const job = await oneVisit();
    const card = async () => (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(await card()).toMatchObject({ discount_code: null });

    await env.DB.prepare(
      `INSERT INTO discount_code_uses (id, code_id, person_id, appointment_id, given_by, given_by_id, created_at)
       SELECT 'use-booked', id, ?1, ?2, 'client', ?1, ?3 FROM discount_codes WHERE code = 'TENPC'`,
    )
      .bind(PERSON, JOB, NOW.toISOString())
      .run();
    expect(await card()).toMatchObject({ discount_code: { code: "TENPC", given_by: "client" } });

    // A visit paid ahead takes no code at the visit, so its card names none.
    await env.DB.prepare("UPDATE appointments SET one_visit = NULL WHERE id = ?1").bind(JOB).run();
    expect(await card()).toMatchObject({ discount_code: null });
  });

  it("says the code the technician entered is on the card once it is read again", async () => {
    await make();
    const job = await oneVisit();
    await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "TENPC" }, "unused");
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ discount_code: { code: "TENPC", given_by: "technician" } });
  });

  it("says only that a code does not apply", async () => {
    await make({ code: "SVC25", covers: ["service"] });
    const job = await oneVisit();
    const answer = await job.post(`/api/tech/jobs/${JOB}/discount-code`, { code: "SVC25" }, "unused");
    expect(answer.status).toBe(422);
    expect(await answer.json()).toEqual({
      error: { code: "code_not_applicable", request_id: expect.any(String) as string },
    });
  });
});

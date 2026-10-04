// A consultation and fit in one visit, at the visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the technician's card offers the products by name, his piece step records the one the client chose or that they
// decided against it, and closing the visit as done sends the client a Razorpay payment link, which Razorpay's
// webhook then says is paid. NOW is Monday 21 September 2026, 12 noon in India; the visit is today at 13:00. Every
// name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { raiseInvoices } from "../../src/domain/fsm-invoices.ts";
import { syncAppointment } from "../../src/domain/fsm-mirror.ts";
import { summaryOf } from "../../src/domain/job-sheet.ts";
import { recordPayment } from "../../src/domain/payments.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { createStubBooks } from "../../src/providers/books.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments, type PaymentsProvider, type StubPayments } from "../../src/providers/payments.ts";
import { ProviderError } from "../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import { termsOfVisit } from "../../src/domain/visit-changes.ts";
import { ONE_VISIT_TERMS } from "../../src/policy/one-visit.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
} from "./helpers.ts";
import { JOB, PERSON, working, type Working } from "./job-fixtures.ts";

/** Mane Man Natural, at Rs. 45,000 with no GST, as staging's book has no GST. */
const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };

/** The first reference of NOW's year, which the visit's link takes before any payment. */
const LINK_REFERENCE = "MM-2026-0001";

const path = (step: string) => `/api/tech/jobs/${JOB}/${step}`;
const A_PIECE = { piece_code: "MM-NAT-4417-A", base: "Lace", supplier_lot: "L-22" };

beforeEach(async () => {
  captureLogs();
  await markDatabase();
});

/** Today's job booked from the site as one visit, with a second product beside the standard first fit. */
async function oneVisit(vendors: { payments?: PaymentsProvider } = {}): Promise<Working> {
  const job = await working("first_fit", vendors);
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

/** Works the visit to its piece step, sends it, then the after photographs; answers the piece step. */
async function toThePiece(job: Working, piece: object): Promise<Response> {
  await job.workTo("consumables");
  await job.post(path("consumables"), { items: [] }, "event-consumables-01");
  const answer = await job.post(path("piece"), piece, "event-piece-01");
  await job.post(path("photos"), { phase: "after" }, "event-afterphotos-01");
  return answer;
}

const closeAsDone = (job: Working, eventId = "event-outcome-01") =>
  job.post(path("outcome"), { outcome: "done" }, eventId);

/** The cron's job that asks again for a link a close could not have made, on its own. */
const linksJob = (job: Working) =>
  runCronJobs(
    CRON_JOBS.filter((cronJob) => cronJob.name === "payment_links"),
    { env, deps: job.deps, config: LOCAL_CONFIG, log: createLogger() },
  );

const visitRow = () => env.DB.prepare("SELECT type, tier, one_visit FROM appointments WHERE id = ?1").bind(JOB).first();
const linkRow = () =>
  env.DB.prepare(
    "SELECT tier, amount, razorpay_link_id IS NOT NULL AS made, sent_at, paid_at FROM payment_links",
  ).first();

describe("the technician's card", () => {
  it("names the products the client may choose, never a price, and runs the first fit's steps and the profile", async () => {
    const job = await oneVisit();
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json<Record<string, unknown>>();
    expect(card).toMatchObject({
      type: "first_fit",
      one_visit: true,
      badge: "at_visit",
      // The first fit's, with the client's hair profile once the product is chosen and fitted (ADR 0106).
      steps: ["before_photos", "checklist", "consumables", "piece", "profile", "after_photos", "outcome"],
      products: [
        { tier: "standard", name: "First fit" },
        { tier: "natural", name: "Mane Man Natural" },
      ],
      payment_link: null,
    });
    // The consultation's checklist, then the fit's: measure and explain, then fit.
    const checklist = (card.checklist as { id: string }[]).map((item) => item.id);
    expect(checklist.slice(0, 3)).toEqual(["scalp_checked", "measurements_taken", "options_shown"]);
    expect(checklist).toContain("piece_set");
    expect(JSON.stringify(card)).not.toContain("4500000");
  });

  it("takes the consultation's items on the checklist step, as well as the fit's", async () => {
    const job = await oneVisit();
    await job.workTo("checklist");
    const answer = await job.post(path("checklist"), { done: ["measurements_taken", "piece_set"] }, "event-cl-01");
    expect(answer.status).toBe(202);
  });

  it("calls any other first fit by its own steps, with no products and its own badge", async () => {
    const job = await working("first_fit");
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ one_visit: false, badge: "prepaid", products: [], payment_link: null });
  });
});

describe("the piece step of a one visit", () => {
  it("records the product the client chose with the piece fitted", async () => {
    const job = await oneVisit();
    expect((await toThePiece(job, { ...A_PIECE, product: NATURAL.tier })).status).toBe(202);
    const step = await env.DB.prepare("SELECT body FROM job_events WHERE kind = 'piece'").first<{ body: string }>();
    expect(JSON.parse(step?.body ?? "{}")).toMatchObject({ piece_code: A_PIECE.piece_code, product: NATURAL.tier });
  });

  it("refuses a product not offered on the visit's day, and a piece with none", async () => {
    const job = await oneVisit();
    await job.workTo("consumables");
    await job.post(path("consumables"), { items: [] }, "event-consumables-01");
    for (const [body, field] of [
      [{ ...A_PIECE, product: "platinum" }, "product"],
      [A_PIECE, "product"],
      [{ ...A_PIECE, product: NATURAL.tier, failure_reason: "Torn" }, "failure_reason"],
    ] as const) {
      const answer = await job.post(path("piece"), body, `event-piece-${field}`);
      expect(answer.status).toBe(400);
      expect((await answer.json<{ error: { fields: string[] } }>()).error.fields).toContain(field);
    }
  });

  it("refuses a product, or a decision against the fit, on any other visit", async () => {
    const job = await working("first_fit");
    await job.workTo("consumables");
    await job.post(path("consumables"), { items: [] }, "event-consumables-01");
    for (const body of [{ declined: true }, { ...A_PIECE, product: "standard" }]) {
      const answer = await job.post(path("piece"), body, `event-piece-${String(Object.keys(body).length)}`);
      expect(answer.status).toBe(400);
    }
  });
});

describe("closing a one visit the client was fitted at", () => {
  it("makes it the product's visit and texts the client its payment link, once however often it lands", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    expect(await closeAsDone(job).then((answer) => answer.json())).toMatchObject({ replayed: true });

    expect(await visitRow()).toEqual({ type: "first_fit", tier: NATURAL.tier, one_visit: "fitted" });
    // MON-30, CP-19: the product as a hair system, and a reference a person can read, not the visit's ID.
    expect(payments.made.links).toEqual([
      {
        amount: NATURAL.amount,
        reference: LINK_REFERENCE,
        description: "Mane Man Natural hair system · fitted Mon 21 Sep",
        customer: { name: "Rohit Malhotra", contact: "+919810000001" },
        notes: { appointment_id: JOB, person_id: PERSON },
      },
    ]);
    expect(await linkRow()).toMatchObject({ tier: NATURAL.tier, amount: NATURAL.amount, made: 1, paid_at: null });
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ payment_link: { url: expect.stringMatching(/^https:\/\/rzp\.io\//) as string } });
  });

  it("is owed on the Tasks board until it is paid", async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "payment_owed")).toMatchObject([
      {
        person: { id: PERSON, name: "Rohit Malhotra" },
        detail: expect.stringMatching(
          new RegExp(`^sent ${String(NATURAL.amount)} https://rzp\\.io/i/\\S+ Mane Man Natural$`),
        ) as string,
      },
    ]);
  });

  // The phone's outbox is one queue for every job, so a close that did not land would hold the rest of the day.
  it("lands while Razorpay cannot be reached, and the cron sends the link once it can", async () => {
    const stub = createStubPayments();
    let reachable = false;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: (link) => (reachable ? stub.createPaymentLink(link) : Promise.reject(new Error("timeout"))),
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    expect(await linkRow()).toMatchObject({ made: 0, sent_at: null });
    await linksJob(job);
    expect(await linkRow()).toMatchObject({ made: 0, sent_at: null });

    reachable = true;
    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
    expect(await linkRow()).toMatchObject({ made: 1 });
    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
  });

  // Razorpay made and texted the link, and its answer never came: the next ask is refused for the same reference.
  it("keeps the link a try whose answer never came made, rather than calling it refused", async () => {
    const stub = createStubPayments();
    let answerLost = true;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: async (link) => {
        const made = await stub.createPaymentLink(link);
        if (!answerLost) return made;
        answerLost = false;
        throw new Error("The operation was aborted due to timeout");
      },
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    expect((await closeAsDone(job)).status).toBe(202);
    expect(await linkRow()).toMatchObject({ made: 0 });

    await linksJob(job);
    expect(stub.made.links).toHaveLength(1);
    expect(await linkRow()).toMatchObject({ made: 1 });
    expect(job.deps.alerts).toEqual([]);
  });

  // A link written before links had a reference may already be at Razorpay under the visit's ID: a new reference
  // would make it a second link, and the client could pay twice.
  it("asks for a link written before links had a reference under the visit's ID", async () => {
    const stub = createStubPayments();
    let reachable = false;
    const payments: PaymentsProvider = {
      ...stub,
      createPaymentLink: (link) => (reachable ? stub.createPaymentLink(link) : Promise.reject(new Error("timeout"))),
    };
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    await env.DB.prepare(
      "UPDATE payment_links SET reference = NULL, reference_year = NULL, reference_number = NULL",
    ).run();

    reachable = true;
    await linksJob(job);
    expect(stub.made.links.map((link) => link.reference)).toEqual([JOB]);
  });

  it("tells ops once when Razorpay refuses the link, with the visit's ID to make one by hand, and asks no more", async () => {
    let asked = 0;
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      createPaymentLink: () => {
        asked += 1;
        return Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "Payment links are off"));
      },
    };
    const job = await oneVisit({ payments: refusing });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });

    expect((await closeAsDone(job)).status).toBe(202);
    await linksJob(job);
    expect(asked).toBe(1);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain(`reference ${JOB}`);
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.find((task) => task.group === "payment_owed")?.detail).toBe(
      `refused ${String(NATURAL.amount)} - Mane Man Natural`,
    );
  });

  it("sends nothing for a visit closed partly done, which stays to be decided", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await job.post(path("outcome"), { outcome: "partial", reason: "client_stopped_it" }, "event-outcome-01");
    expect(payments.made.links).toEqual([]);
    expect(await visitRow()).toMatchObject({ one_visit: "booked" });
  });
});

describe("closing a one visit the client decided against", () => {
  it("makes it a consultation, with nothing charged, sent or invoiced, and the mirror keeps it so", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    expect((await toThePiece(job, { declined: true })).status).toBe(202);
    expect((await closeAsDone(job)).status).toBe(202);

    expect(await visitRow()).toEqual({ type: "consultation", tier: "standard", one_visit: "declined" });
    expect(payments.made.links).toEqual([]);
    expect(await linkRow()).toBeNull();

    // FSM completes it on the first fit's item, which is all it knows of the visit.
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-fit", name: "First fit", type: "Service", price: 3_000_000 }],
      appointments: [
        {
          id: "ap-today",
          name: "AP-1",
          status: "Completed",
          workOrderId: "wo-ap-today",
          contactId: "contact-1",
          scheduledStart: "2026-09-21T13:00:00+05:30",
          scheduledEnd: "2026-09-21T16:00:00+05:30",
          actualStart: "2026-09-21T13:05:00+05:30",
          actualEnd: "2026-09-21T15:40:00+05:30",
          technicianIds: ["resource-1"],
          serviceIds: ["item-fit"],
          serviceCity: "Gurgaon",
          servicePincode: "122018",
          modifiedAt: "2026-09-21T15:41:00+05:30",
        },
      ],
    });
    await syncAppointment(env.DB, fsm, "ap-today", NOW);
    expect(await visitRow()).toEqual({ type: "consultation", tier: "standard", one_visit: "declined" });

    const alertOnce = createAlertOnce({
      db: env.DB,
      alert: () => Promise.resolve(),
      now: () => NOW,
      environment: "local",
      log: createLogger(),
    });
    const resolveAlert = createResolveAlert({ db: env.DB, now: () => NOW });
    const books = createStubBooks();
    await raiseInvoices(
      env.DB,
      { fsm, books, alertOnce, resolveAlert },
      NOW,
      createLogger(),
      createCallBudget(Infinity),
    );
    expect(fsm.made.invoiced).toEqual([]);
  });

  it("says so in FSM's summary of the visit", async () => {
    const job = await oneVisit();
    await toThePiece(job, { declined: true });
    await closeAsDone(job);
    const visit = {
      id: JOB,
      fsmId: "ap-today",
      type: "consultation" as const,
      oneVisit: true,
      personId: PERSON,
      fsmContactId: "contact-1",
    };
    const summary = await summaryOf(env.DB, visit, { labelAsTest: false });
    expect(summary.startsWith("Consultation and fit · ")).toBe(true);
    expect(summary).toContain("No piece: the client decided against the fit");
  });
});

describe("Razorpay's word that a one visit's link is paid", () => {
  const SECRET = "a-razorpay-webhook-secret-for-tests";

  async function deliver(event: object, eventId: string) {
    const body = JSON.stringify(event);
    const settings = { razorpay: { keyId: "rzp_test_abc", keySecret: "key-secret", webhookSecret: SECRET } };
    const app = appFor("local", fakeDependencies(), { ...LOCAL_SETTINGS, ...settings });
    return request(app, "/api/hooks/razorpay", {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Razorpay-Signature": await saltedHash(SECRET, body),
        "X-Razorpay-Event-Id": eventId,
      },
    });
  }

  /** Razorpay's payment_link.paid, for the link made for the visit or one ops made by hand with its reference. */
  function linkPaid(link: { id: string; reference_id: string | null }) {
    return {
      entity: "event",
      event: "payment_link.paid",
      contains: ["payment_link", "order", "payment"],
      payload: {
        payment_link: { entity: { ...link, status: "paid", amount: NATURAL.amount, amount_paid: NATURAL.amount } },
        payment: {
          entity: {
            id: "pay_link_1",
            entity: "payment",
            amount: NATURAL.amount,
            currency: "INR",
            status: "captured",
            order_id: "order_link_1",
            method: "upi",
            contact: "+919810000001",
            notes: [],
            created_at: 1790067435,
          },
        },
      },
    };
  }

  async function fittedAndClosed(payments: StubPayments): Promise<string> {
    const job = await oneVisit({ payments });
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    const made = await env.DB.prepare("SELECT razorpay_link_id FROM payment_links").first<{
      razorpay_link_id: string;
    }>();
    return made?.razorpay_link_id ?? "";
  }

  it("records the payment as the visit's, with its split before GST and the link's reference, and the task goes", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    expect((await deliver(linkPaid({ id: linkId, reference_id: LINK_REFERENCE }), "evt-1")).status).toBe(200);

    const payment = await env.DB.prepare(
      `SELECT person_id, appointment_id, kind, status, amount, amount_ex_gst, gst_percent, reference
       FROM payments WHERE razorpay_payment_id = 'pay_link_1'`,
    ).first();
    expect(payment).toEqual({
      person_id: PERSON,
      appointment_id: JOB,
      kind: "visit",
      status: "captured",
      amount: NATURAL.amount,
      amount_ex_gst: NATURAL.amount,
      gst_percent: 0,
      // What the client read on Razorpay's page is what their receipt and the app say.
      reference: LINK_REFERENCE,
    });
    expect(await linkRow()).toMatchObject({ paid_at: "2026-09-22T08:57:15.000Z" });
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "payment_owed")).toEqual([]);
  });

  it("numbers a payment captured while the link waits after the link, never with the link's number", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    const another = {
      id: "pay_other",
      amount: 200000,
      currency: "INR",
      status: "captured",
      order_id: "order_other",
      notes: [],
      created_at: 1790067000,
    };
    await recordPayment(env.DB, another, "captured", "a-salt", NOW);
    await deliver(linkPaid({ id: linkId, reference_id: LINK_REFERENCE }), "evt-1");

    const { results } = await env.DB.prepare(
      "SELECT razorpay_payment_id, reference FROM payments ORDER BY reference",
    ).all();
    expect(results).toEqual([
      { razorpay_payment_id: "pay_link_1", reference: LINK_REFERENCE },
      { razorpay_payment_id: "pay_other", reference: "MM-2026-0002" },
    ]);
  });

  // Razorpay sends payment.captured for a link's payment too, often first, with the link's notes.
  it("gives the payment the link's reference though its capture arrives before the link's paid event", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    const paid = linkPaid({ id: linkId, reference_id: LINK_REFERENCE });
    const payment = { ...paid.payload.payment.entity, notes: { appointment_id: JOB, person_id: PERSON } };
    await deliver({ entity: "event", event: "payment.captured", payload: { payment: { entity: payment } } }, "evt-7");
    await deliver(paid, "evt-8");

    const { results } = await env.DB.prepare("SELECT reference FROM payments").all();
    expect(results).toEqual([{ reference: LINK_REFERENCE }]);
  });

  it("finds the visit by the link's reference where Razorpay's answer to the close never came", async () => {
    const stub = createStubPayments();
    const answerLost: StubPayments = {
      ...stub,
      createPaymentLink: async (link) => {
        await stub.createPaymentLink(link);
        throw new Error("The operation was aborted due to timeout");
      },
    };
    await fittedAndClosed(answerLost);
    await deliver(linkPaid({ id: "plink_unseen", reference_id: LINK_REFERENCE }), "evt-6");
    expect(await linkRow()).toMatchObject({ made: 0, paid_at: "2026-09-22T08:57:15.000Z" });
  });

  it("finds the visit by its reference, for a link ops made by hand", async () => {
    await fittedAndClosed(createStubPayments());
    await deliver(linkPaid({ id: "plink_by_hand", reference_id: JOB }), "evt-2");
    const payment = await env.DB.prepare("SELECT appointment_id FROM payments").first();
    expect(payment).toEqual({ appointment_id: JOB });
    expect(await linkRow()).toMatchObject({ paid_at: "2026-09-22T08:57:15.000Z" });
  });

  it("finds the visit by its reference for a link ops made by hand where no close made one", async () => {
    await oneVisit();
    expect((await deliver(linkPaid({ id: "plink_by_hand", reference_id: JOB }), "evt-4")).status).toBe(200);
    const payment = await env.DB.prepare("SELECT person_id, appointment_id, kind, status FROM payments").first();
    expect(payment).toEqual({ person_id: PERSON, appointment_id: JOB, kind: "visit", status: "captured" });
    expect(await linkRow()).toBeNull();
  });

  it("records nothing for a link that is not ours, whose payment its own event records", async () => {
    await deliver(linkPaid({ id: "plink_other", reference_id: "someone-else" }), "evt-3");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM payments").first()).toEqual({ n: 0 });
  });

  it("leaves the client nothing to cancel or move, though FSM still has the visit dispatched", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    await deliver(linkPaid({ id: linkId, reference_id: JOB }), "evt-1");
    await env.DB.prepare("UPDATE appointments SET status = 'dispatched' WHERE id = ?1").bind(JOB).run();

    const client = appFor("local", fakeDependencies(), {}, "client");
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    const ask = (change: string, body: object) =>
      request(client, `/api/appointments/${JOB}/${change}`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify(body),
      });
    const cancel = await ask("cancel", { confirm: false });
    expect(cancel.status).toBe(409);
    expect(await cancel.json()).toMatchObject({ error: { code: "not_changeable" } });
    expect((await ask("reschedule", {})).status).toBe(409);
    const me = await (await request(client, "/api/me", { headers: { Cookie: cookie } })).json();
    expect(me).toMatchObject({ next_visit: { id: JOB, stage: "done" } });
  });
});

// While self-serve booking is off, a one visit is a request ops book in FSM by hand (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
describe("a one visit ops book by hand while booking is off", () => {
  const BY_HAND = "ap-by-hand";

  /** FSM's first fit for the client, as ops booked it: on the first fit's item, for three hours, tomorrow. */
  const fsmWithTheFit = () =>
    createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-fit", name: "First fit", type: "Service", price: 3_000_000 }],
      appointments: [
        {
          id: BY_HAND,
          name: "AP-9",
          status: "Scheduled",
          workOrderId: "wo-by-hand",
          contactId: "contact-1",
          scheduledStart: "2026-09-22T09:00:00+05:30",
          scheduledEnd: "2026-09-22T12:00:00+05:30",
          actualStart: null,
          actualEnd: null,
          technicianIds: ["resource-1"],
          serviceIds: ["item-fit"],
          serviceCity: "Gurgaon",
          servicePincode: "122018",
          modifiedAt: "2026-09-21T12:00:00+05:30",
        },
      ],
    });

  const asked = (oneVisit: number) =>
    env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at, one_visit)
       VALUES (?1, ?2, '122018', '2026-09-22', 'morning', ?3, ?4)`,
    )
      .bind(crypto.randomUUID(), PERSON, NOW.toISOString(), oneVisit)
      .run();

  const handBooked = () =>
    env.DB.prepare("SELECT id, one_visit FROM appointments WHERE fsm_id = ?1")
      .bind(BY_HAND)
      .first<{ id: string; one_visit: string | null }>();

  it("is marked as one visit when the mirror first sees it, sold to cost nothing, and its request leaves the board", async () => {
    await working("service");
    await asked(1);
    await syncAppointment(env.DB, fsmWithTheFit(), BY_HAND, NOW);

    const visit = await handBooked();
    expect(visit?.one_visit).toBe("booked");
    const booked = await env.DB.prepare("SELECT booked FROM consultation_requests").first();
    expect(booked).toEqual({ booked: 1 });
    const { tasks } = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(tasks.filter((task) => task.group === "consultation_request")).toEqual([]);

    const inForce = { noticeHours: 24, lateCharge: "late_fee", noShowCharge: "late_fee" } as const;
    const sold = await termsOfVisit(
      env.DB,
      { id: visit?.id ?? "", type: "first_fit", start: new Date("2026-09-22T03:30:00.000Z") },
      inForce,
    );
    expect(sold).toEqual({ terms: ONE_VISIT_TERMS, lateFee: null });
  });

  it("leaves a first fit alone for a client who asked for the consultation alone", async () => {
    await working("service");
    await asked(0);
    await syncAppointment(env.DB, fsmWithTheFit(), BY_HAND, NOW);
    expect((await handBooked())?.one_visit).toBeNull();
  });
});

// A consultation and fit in one visit, at the visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the technician's card offers the products by name, his piece step records the one the client chose or that they
// decided against it, and closing the visit as done sends the client a Razorpay payment link, which Razorpay's
// webhook then says is paid. NOW is Monday 21 September 2026, 12 noon in India; the visit is today at 13:00. Every
// name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { composeLinkPaid } from "../../src/domain/payment-links.ts";
import { recordPayment } from "../../src/domain/payments.ts";
import { renderMessage } from "../../src/config/message-templates.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { createLogger } from "../../src/log.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../src/providers/payments/stub.ts";
import { ProviderError } from "../../src/providers/provider-error.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import type { Settings } from "../../src/config/settings.ts";
import { RULES } from "../../src/policy/one-visit.ts";
import { RULES as STAGING_RULES } from "../../src/policy/staging-test-records.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  deliverRazorpay,
} from "./helpers.ts";
import { JOB, PERSON, working, type Working } from "./job-fixtures.ts";

/** Mane Man Natural, at Rs. 45,000 with no GST, as staging's book has no GST. */
const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };

/** The first reference of NOW's year, which the visit's link takes before any payment. */
const LINK_REFERENCE = "MM-2026-0001";

/** Fourteen days after NOW, when a link made at NOW stops taking payment. */
const TWO_WEEKS_ON = new Date("2026-10-05T06:30:00.000Z");

/** Staging's messaging, texting only the handsets named. */
const allowing = (...handsets: string[]): Partial<Settings> => ({
  messaging: { ...LOCAL_SETTINGS.messaging, allowlist: handsets },
});

const path = (step: string) => `/api/tech/jobs/${JOB}/${step}`;
const A_PIECE = { piece_code: "MM-NAT-4417-A", base: "Lace", supplier_lot: "L-22" };

beforeEach(async () => {
  captureLogs();
  await markDatabase();
});

/** Today's job booked from the site as one visit, with a second product beside the standard first fit. */
async function oneVisit(
  vendors: { payments?: PaymentsProvider } = {},
  settings: Partial<Settings> = {},
): Promise<Working> {
  const job = await working("first_fit", vendors, settings);
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

/** Works the visit to its piece step, sends it, then the rest up to the outcome; answers the piece step. */
async function toThePiece(job: Working, piece: object): Promise<Response> {
  await job.workTo("piece");
  const answer = await job.post(path("piece"), piece, "event-piece-01");
  await job.post(path("checklist"), { done: [] }, "event-checklist-01");
  await job.post(path("consumables"), { items: [] }, "event-consumables-01");
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
      // The first fit's, the client's choice first, with their hair profile once the product is fitted (ADR 0106).
      steps: ["before_photos", "piece", "checklist", "consumables", "profile", "after_photos", "outcome"],
      products: [
        { tier: "standard", name: "First fit" },
        { tier: "natural", name: "Mane Man Natural" },
      ],
      payment_link: null,
      client_choice: null,
    });
    // The consultation's checklist, then the fit's: measure and explain, then fit.
    const checklist = (card.checklist as { id: string }[]).map((item) => item.id);
    expect(checklist.slice(0, 3)).toEqual(["scalp_checked", "measurements_taken", "options_shown"]);
    expect(checklist).toContain("piece_set");
    // The consultation's alone, for a client who decides against the fit.
    const ifDeclined = (card.checklist_if_declined as { id: string }[]).map((item) => item.id);
    expect(ifDeclined).toEqual(["scalp_checked", "measurements_taken", "options_shown"]);
    expect(JSON.stringify(card)).not.toContain("4500000");
  });

  it("takes the consultation's items on the checklist step, as well as the fit's", async () => {
    const job = await oneVisit();
    await job.workTo("piece");
    await job.post(path("piece"), { ...A_PIECE, product: NATURAL.tier }, "event-piece-01");
    const answer = await job.post(path("checklist"), { done: ["measurements_taken", "piece_set"] }, "event-cl-01");
    expect(answer.status).toBe(202);
  });

  // The choice comes first, so the checklist after it knows whether anything is fitted.
  it("takes the client's choice before the checklist, and says on the card what they chose", async () => {
    const job = await oneVisit();
    await job.workTo("piece");
    const early = await job.post(path("checklist"), { done: ["scalp_checked"] }, "event-cl-early");
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "out_of_order", fields: ["piece"] } });

    await job.post(path("piece"), { declined: true }, "event-piece-01");
    expect(await (await job.get(`/api/tech/jobs/${JOB}`)).json()).toMatchObject({ client_choice: { declined: true } });
    expect((await job.post(path("checklist"), { done: ["scalp_checked"] }, "event-cl-01")).status).toBe(202);
  });

  it("calls any other first fit by its own steps, with no products and its own badge", async () => {
    const job = await working("first_fit");
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({
      one_visit: false,
      badge: "prepaid",
      products: [],
      payment_link: null,
      client_choice: null,
      checklist_if_declined: [],
    });
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
    await job.workTo("piece");
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
    // The product as a hair system, and a reference a person can read, not the visit's ID.
    expect(payments.made.links).toEqual([
      {
        amount: NATURAL.amount,
        reference: LINK_REFERENCE,
        description: "Mane Man Natural hair system · fitted Mon 21 Sep",
        customer: { name: "Rohit Malhotra", contact: "+919810000001" },
        notes: { appointment_id: JOB, person_id: PERSON },
        closesAt: TWO_WEEKS_ON,
        notify: true,
      },
    ]);
    expect(await linkRow()).toMatchObject({ tier: NATURAL.tier, amount: NATURAL.amount, made: 1, paid_at: null });
    const card = await (await job.get(`/api/tech/jobs/${JOB}`)).json();
    expect(card).toMatchObject({ payment_link: { url: expect.stringMatching(/^https:\/\/rzp\.io\//) as string } });
  });

  // A link took payment, and Razorpay kept reminding the client, however long it went unpaid.
  it(RULES[3], async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    const owed = async (at: Date) =>
      (await outstandingTasks(env.DB, at, TASK_SLA_HOURS)).tasks.find((task) => task.group === "payment_owed")?.detail;

    // The task reads "<state> <paise> <link address> <product>".
    const reads = (state: string) =>
      new RegExp(`^${state} ${String(NATURAL.amount)} https://rzp\\.io/i/\\S+ Mane Man Natural$`);
    expect(await owed(new Date(TWO_WEEKS_ON.getTime() - 60_000))).toMatch(reads("sent"));
    expect(await owed(TWO_WEEKS_ON)).toMatch(reads("closed"));
  });

  // On staging a test record's made-up number, very likely a stranger's, was texted "pay Rs. 30,000".
  it(STAGING_RULES[3], async () => {
    const logs = captureLogs();
    const payments = createStubPayments();
    const job = await oneVisit({ payments }, allowing("+919810000777"));
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);

    expect(payments.made.links).toMatchObject([{ customer: { contact: "+919810000001" }, notify: false }]);
    // Made all the same, for ops to send from the client's Payments tab.
    expect(await linkRow()).toMatchObject({ made: 1 });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "payment_link_not_texted", appointment_id: JOB }),
    );
  });

  it("texts the link on staging to a number on the allowlist", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments }, allowing("+919810000001"));
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await closeAsDone(job);
    expect(payments.made.links).toMatchObject([{ notify: true }]);
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

  it("names the hair system, not its code, when the book has no price for it that day", async () => {
    const job = await oneVisit();
    await toThePiece(job, { ...A_PIECE, product: NATURAL.tier });
    await env.DB.prepare("DELETE FROM price_book WHERE item = 'first_fit' AND tier = ?1").bind(NATURAL.tier).run();

    expect((await closeAsDone(job)).status).toBe(202);
    expect(job.deps.alerts).toHaveLength(1);
    expect(job.deps.alerts[0]).toContain("the client was fitted with Mane Man Natural, which the price book has no");
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
  it("makes it a consultation, with nothing charged or sent", async () => {
    const payments = createStubPayments();
    const job = await oneVisit({ payments });
    expect((await toThePiece(job, { declined: true })).status).toBe(202);
    expect((await closeAsDone(job)).status).toBe(202);

    expect(await visitRow()).toEqual({ type: "consultation", tier: "standard", one_visit: "declined" });
    expect(payments.made.links).toEqual([]);
    expect(await linkRow()).toBeNull();
  });
});

describe("Razorpay's word that a one visit's link is paid", () => {
  const deliver = (event: object, eventId: string, deps = fakeDependencies()) =>
    deliverRazorpay(event, { eventId, deps });

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

  // The largest payment in the product was the only one we never confirmed.
  it("queues the client's receipt once, however often the payment is told of, whatever their consent", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    await deliver(linkPaid({ id: linkId, reference_id: LINK_REFERENCE }), "evt-1");
    await deliver(linkPaid({ id: linkId, reference_id: LINK_REFERENCE }), "evt-2");

    const { results } = await env.DB.prepare(
      "SELECT kind, subject_kind, subject_id, state FROM outbound_messages WHERE kind = 'link_paid'",
    ).all();
    expect(results).toEqual([{ kind: "link_paid", subject_kind: "appointment", subject_id: JOB, state: "queued" }]);
    const composed = await composeLinkPaid(env.DB, JOB, PERSON);
    expect(composed).toEqual({
      template: "link_paid_v1",
      params: ["Rohit", "Mane Man Natural hair system", "", "", "", "Rs. 45,000", LINK_REFERENCE],
    });
    expect("template" in composed && renderMessage(composed.template, composed.params)).toBe(
      "Hi Rohit, thank you: we've received Rs. 45,000 for your Mane Man Natural hair system " +
        `(ref ${LINK_REFERENCE}). Welcome to Mane Man. Your receipt is in the app.`,
    );
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

  // The visit's own link stayed payable, with Razorpay's reminders, once the visit was paid another way.
  it("cancels the visit's own link once the client pays one ops made by hand", async () => {
    const own = await fittedAndClosed(createStubPayments());
    const payments = createStubPayments();
    await deliver(linkPaid({ id: "plink_by_hand", reference_id: JOB }), "evt-9", fakeDependencies({ payments }));
    expect(payments.made.cancelledLinks).toEqual([own]);
  });

  it("cancels nothing when the client pays the visit's own link", async () => {
    const own = await fittedAndClosed(createStubPayments());
    const payments = createStubPayments();
    await deliver(linkPaid({ id: own, reference_id: LINK_REFERENCE }), "evt-10", fakeDependencies({ payments }));
    expect(payments.made.cancelledLinks).toEqual([]);
  });

  it("leaves the visit's own link alone once it has closed by its time", async () => {
    await fittedAndClosed(createStubPayments());
    const payments = createStubPayments();
    const deps = fakeDependencies({ payments, now: () => TWO_WEEKS_ON });
    await deliver(linkPaid({ id: "plink_by_hand", reference_id: JOB }), "evt-11", deps);
    expect(payments.made.cancelledLinks).toEqual([]);
  });

  it("tells ops once when Razorpay will not cancel the visit's own link, and still records the payment", async () => {
    const own = await fittedAndClosed(createStubPayments());
    const refusing: PaymentsProvider = {
      ...createStubPayments(),
      cancelPaymentLink: () =>
        Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "Payment link cannot be cancelled")),
    };
    const deps = fakeDependencies({ payments: refusing });
    const answer = await deliver(linkPaid({ id: "plink_by_hand", reference_id: JOB }), "evt-12", deps);

    expect(answer.status).toBe(200);
    expect(deps.alerts).toHaveLength(1);
    expect(deps.alerts[0]).toContain(own);
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

  it("leaves the client nothing to cancel or move once it is closed and paid", async () => {
    const linkId = await fittedAndClosed(createStubPayments());
    await deliver(linkPaid({ id: linkId, reference_id: JOB }), "evt-1");

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
    const terms = await request(client, `/api/appointments/${JOB}/reschedule`, { headers: { Cookie: cookie } });
    expect(terms.status).toBe(409);
    const visits = await (await request(client, "/api/visits", { headers: { Cookie: cookie } })).json();
    expect(visits).toMatchObject({ upcoming: [], past: [{ id: JOB, status: "completed" }] });
  });
});

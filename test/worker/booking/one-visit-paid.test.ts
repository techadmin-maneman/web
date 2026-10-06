// A consultation and fit in one visit, at the visit (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md):
// the technician's card offers the products by name, their piece step records the one the client chose or that they
// decided against it, and closing the visit as done sends the client a Razorpay payment link, which Razorpay's
// webhook then says is paid. NOW is Monday 21 September 2026, 12 noon in India; the visit is today at 13:00. Every
// name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { composeLinkPaid } from "../../../src/domain/money/payment-links-paid.ts";
import { recordPayment } from "../../../src/domain/money/payments.ts";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { ProviderError } from "../../../src/providers/provider-error.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request, deliverRazorpay } from "../helpers.ts";
import { JOB, PERSON } from "../job-fixtures.ts";
import {
  NATURAL,
  LINK_REFERENCE,
  TWO_WEEKS_ON,
  A_PIECE,
  oneVisit,
  toThePiece,
  closeAsDone,
  linkRow,
} from "./one-visit-fixtures.ts";

beforeEach(async () => {
  captureLogs();
  await markDatabase();
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
    await recordPayment({ db: env.DB, payment: another, status: "captured", hashSalt: "a-salt", now: NOW });
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

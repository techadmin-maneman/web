// A paid visit ops book while online payment is off: booked at once, paid by UPI at the visit, and recorded by ops
// once the money reaches the account (docs/decisions/0209-paid-at-the-visit-by-upi.md).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { composeVisitMessage } from "../../../src/domain/messages/visit-message-text.ts";
import { askRefund } from "../../../src/domain/money/refunds.ts";
import { composeUpiReceived } from "../../../src/domain/money/upi-payments.ts";
import { createLogger } from "../../../src/log.ts";
import { createPaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "../helpers.ts";
import { aPayment, aPaymentLink, aVisit } from "../fixtures/index.ts";
import { IMRAN, NATURAL, ROHIT, bindings, rohit, technician } from "./ops-visits-fixtures.ts";

/** The console where no payment can be taken online: PAYMENTS_PROVIDER is none. */
const offline = () =>
  appFor(
    "local",
    { ...fakeDependencies(), payments: createPaymentsProvider("none", null, { fetch, log: createLogger() }) },
    {},
    "ops",
  );

const post = (path: string, body: object) =>
  request(
    offline(),
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

const bookFit = () =>
  post("/api/visits", { client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: "2026-09-25", window: "morning" });

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
    ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
    ).bind(NATURAL.tier, NATURAL.amount),
  ]);
  await rohit("consulted");
});

describe("a paid visit booked while online payment is off", () => {
  it("is booked at once, to be paid by UPI at the visit, with nothing kept for a late change or a no-show", async () => {
    const answer = await bookFit();
    expect(await answer.json()).toMatchObject({ outcome: "booked", link: null });
    expect(answer.status).toBe(201);
    const hold = await env.DB.prepare(
      "SELECT pay_at_visit, pay_by_link, late_change_charge, no_show_charge, appointment_id FROM slot_holds",
    ).first<{ appointment_id: string }>();
    expect(hold).toMatchObject({
      pay_at_visit: 1,
      pay_by_link: 0,
      late_change_charge: "nothing",
      no_show_charge: "nothing",
    });

    const told = await composeVisitMessage(env.DB, "payment_receipt", hold?.appointment_id ?? "", ROHIT);
    expect(told).toMatchObject({ template: "visit_booked_at_visit_v1" });
    expect("params" in told ? told.params[5] : null).toBe(`Rs. ${(NATURAL.amount / 100).toLocaleString("en-IN")}`);
  });

  it("is recorded paid by its UTR, once, with a reference and the client's receipt", async () => {
    await bookFit();
    const visit = (await env.DB.prepare("SELECT appointment_id FROM slot_holds").first<string>("appointment_id")) ?? "";

    const paid = await post(`/api/visits/${visit}/upi-payment`, { utr: "412345678901" });
    expect(paid.status).toBe(200);
    const { payment_id: paymentId } = await paid.json<{ payment_id: string }>();
    const payment = await env.DB.prepare(
      "SELECT razorpay_payment_id, method, status, amount, reference IS NOT NULL AS referenced FROM payments WHERE id = ?1",
    )
      .bind(paymentId)
      .first();
    expect(payment).toEqual({
      razorpay_payment_id: "upi:412345678901",
      method: "upi",
      status: "captured",
      amount: NATURAL.amount,
      referenced: 1,
    });
    expect(await composeUpiReceived(env.DB, paymentId, ROHIT)).toMatchObject({ template: "upi_received_v1" });
    const receipts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbound_messages WHERE kind = 'upi_received' AND subject_id = ?1",
    )
      .bind(paymentId)
      .first();
    expect(receipts).toEqual({ n: 1 });

    const again = await post(`/api/visits/${visit}/upi-payment`, { utr: "412345678902" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "already_paid" } });
  });

  it("is refunded by UPI from the bank, not through Razorpay: the console's refund is refused with that said", async () => {
    await bookFit();
    const visit = (await env.DB.prepare("SELECT appointment_id FROM slot_holds").first<string>("appointment_id")) ?? "";
    const paid = await post(`/api/visits/${visit}/upi-payment`, { utr: "412345678901" });
    const { payment_id: paymentId } = await paid.json<{ payment_id: string }>();

    const refund = await post(`/api/payments/${paymentId}/refund`, { reason: "Asked for it back" });
    expect(refund.status).toBe(409);
    expect(await refund.json()).toMatchObject({ error: { code: "paid_by_upi" } });
  });

  it("refuses a UTR already recorded, and a visit not paid at the visit", async () => {
    await bookFit();
    const visit = (await env.DB.prepare("SELECT appointment_id FROM slot_holds").first<string>("appointment_id")) ?? "";
    await aPayment({ person_id: ROHIT, razorpay_payment_id: "upi:412345678901", amount: 100 });
    const used = await post(`/api/visits/${visit}/upi-payment`, { utr: "412345678901" });
    expect(await used.json()).toMatchObject({ error: { code: "reference_used" } });

    await env.DB.prepare("UPDATE slot_holds SET pay_at_visit = 0").run();
    const notDue = await post(`/api/visits/${visit}/upi-payment`, { utr: "412345678903" });
    expect(await notDue.json()).toMatchObject({ error: { code: "not_due" } });
  });
});

describe("a one visit fitted whose link was never paid", () => {
  it("is settled by a UPI payment under its UTR, which pays the link so nobody asks for it again", async () => {
    const { id: fitted = "" } = await aVisit({
      person_id: ROHIT,
      type: "first_fit",
      status: "completed",
      one_visit: "fitted",
    });
    await aPaymentLink({ appointment_id: fitted, refused_at: NOW.toISOString(), short_url: null, sent_at: null });

    const paid = await post(`/api/visits/${fitted}/upi-payment`, { utr: "412345678911" });
    expect(paid.status).toBe(200);
    const payment = await env.DB.prepare("SELECT amount, razorpay_payment_id FROM payments WHERE appointment_id = ?1")
      .bind(fitted)
      .first();
    expect(payment).toEqual({ amount: 3_200_000, razorpay_payment_id: "upi:412345678911" });
    const link = await env.DB.prepare("SELECT paid_at FROM payment_links WHERE appointment_id = ?1")
      .bind(fitted)
      .first();
    expect(link).toEqual({ paid_at: NOW.toISOString() });
  });
});

describe("a payment made by UPI outside Razorpay", () => {
  it("is never refunded through Razorpay: the refund is refused, for ops to make by UPI", async () => {
    const payments = createStubPayments();
    const outcome = await askRefund(payments, "upi:412345678901", { amount: 220_000, receipt: "r-1", notes: {} });
    expect(outcome.kind).toBe("refused");
    expect(payments.made.refunds).toEqual([]);
  });
});

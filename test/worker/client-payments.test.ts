// The client app's payments and documents. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

let client: App;
let cookie: string;

async function person(id: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), mobile)
    .run();
}

async function visit(id: string, personId: string, invoiceId: string | null) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_invoice_id, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, 'first_fit', 'completed', 'Completed', '2026-09-10T04:30:00.000Z', '2026-09-10T07:30:00.000Z',
       ?4, ?5, ?5)`,
  )
    .bind(id, `fsm-${id}`, personId, invoiceId, NOW.toISOString())
    .run();
}

async function payment(id: string, personId: string, appointmentId: string | null, createdAt: string) {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 3540000, 'INR', 'upi', 'captured', ?6, ?6)`,
  )
    .bind(id, `MM-2026-${id.slice(-4)}`, personId, appointmentId, `pay_${id}`, createdAt)
    .run();
}

const get = (path: string) => request(client, path, { headers: { Cookie: cookie } });

const P1 = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAY_OLD = "33333333-3333-4333-8333-333333330001";
const PAY_NEW = "33333333-3333-4333-8333-333333330002";

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
  await person(P1, "+919810000001");
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: P1, deviceLabel: null, now: NOW })}`;
});

async function refund(id: string, paymentId: string, status: "created" | "processed", createdAt: string) {
  await env.DB.prepare(
    `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, updated_at)
     VALUES (?1, ?2, ?3, 236000, ?4, 'normal', ?5, ?5)`,
  )
    .bind(id, paymentId, `rfnd_${id}`, status, createdAt)
    .run();
}

const REFUND = "55555555-5555-4555-8555-555555555555";

describe("GET /api/payments", () => {
  it("lists payments and refunds as one list, newest first, each with its ex-GST figure", async () => {
    await visit(VISIT, P1, "stub-41");
    await payment(PAY_OLD, P1, VISIT, "2026-09-01T06:00:00.000Z");
    await payment(PAY_NEW, P1, null, "2026-09-15T06:00:00.000Z");
    await refund(REFUND, PAY_OLD, "created", "2026-09-10T06:00:00.000Z");
    const { entries } = await (await get("/api/payments")).json<{ entries: Record<string, unknown>[] }>();
    expect(entries).toEqual([
      expect.objectContaining({ kind: "payment", id: PAY_NEW, date: "2026-09-15", visit: null }),
      expect.objectContaining({
        kind: "refund",
        id: REFUND,
        payment_id: PAY_OLD,
        amount: 236000,
        amount_ex_gst: 200000,
        status: "created",
        destination: "upi",
        speed: "normal",
      }),
      expect.objectContaining({
        kind: "payment",
        id: PAY_OLD,
        reference: "MM-2026-0001",
        amount: 3540000,
        amount_ex_gst: 3000000,
        gst_percent: 18,
        status: "captured",
        method: "upi",
        visit: { id: VISIT, date: "2026-09-10", type: "first_fit" },
      }),
    ]);
  });

  it("leaves out a failed attempt", async () => {
    await payment(PAY_OLD, P1, null, "2026-09-01T06:00:00.000Z");
    await env.DB.prepare("UPDATE payments SET status = 'failed' WHERE id = ?1").bind(PAY_OLD).run();
    expect((await (await get("/api/payments")).json<{ entries: unknown[] }>()).entries).toEqual([]);
    expect((await get(`/api/payments/${PAY_OLD}`)).status).toBe(404);
  });

  it("shows a payment with its visit's invoice, and a refund with its destination", async () => {
    await visit(VISIT, P1, "stub-41");
    await payment(PAY_OLD, P1, VISIT, "2026-09-01T06:00:00.000Z");
    await refund(REFUND, PAY_OLD, "processed", "2026-09-02T06:00:00.000Z");
    expect(await (await get(`/api/payments/${PAY_OLD}`)).json()).toMatchObject({
      kind: "payment",
      documents: { invoice: VISIT, receipt: null },
    });
    expect(await (await get(`/api/payments/${REFUND}`)).json()).toMatchObject({
      kind: "refund",
      date: "2026-09-02",
      status: "processed",
      destination: "upi",
      voucher: null,
    });
  });

  it("does not show another client's payment or refund", async () => {
    await person("p2", "+919810000002");
    await payment(PAY_OLD, "p2", null, "2026-09-01T06:00:00.000Z");
    await refund(REFUND, PAY_OLD, "created", "2026-09-02T06:00:00.000Z");
    expect((await get(`/api/payments/${PAY_OLD}`)).status).toBe(404);
    expect((await get(`/api/payments/${REFUND}`)).status).toBe(404);
    expect((await (await get("/api/payments")).json<{ entries: unknown[] }>()).entries).toEqual([]);
  });
});

describe("GET /api/documents/:id", () => {
  it("streams a visit's invoice from Books", async () => {
    await visit(VISIT, P1, "stub-41");
    const response = await get(`/api/documents/${VISIT}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(await response.text()).toMatch(/^%PDF-1\.4/);
  });

  it("says not ready while Books has not raised the invoice, and not found for another client's visit", async () => {
    await visit(VISIT, P1, null);
    expect((await get(`/api/documents/${VISIT}`)).status).toBe(409);
    await person("p2", "+919810000002");
    const theirs = "44444444-4444-4444-8444-444444444444";
    await visit(theirs, "p2", "stub-42");
    expect((await get(`/api/documents/${theirs}`)).status).toBe(404);
  });
});

// The client app's payments and documents. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

let client: App;
let cookie: string;

async function person(id: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Rohit Malhotra')")
    .bind(id, NOW.toISOString(), mobile)
    .run();
}

/** A finished visit, with the invoice Books holds for it; `issued` is false while that invoice is a draft. */
async function visit(id: string, personId: string, invoiceId: string | null, issued = true) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_invoice_id, invoice_issued_at, fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, 'first_fit', 'completed', 'Completed', '2026-09-10T04:30:00.000Z', '2026-09-10T07:30:00.000Z',
       ?4, ?5, ?6, ?6)`,
  )
    .bind(
      id,
      `fsm-${id}`,
      personId,
      invoiceId,
      invoiceId !== null && issued ? NOW.toISOString() : null,
      NOW.toISOString(),
    )
    .run();
}

async function payment(id: string, personId: string, appointmentId: string | null, createdAt: string) {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 3000000, 'INR', 'upi', 'captured', ?6, ?6)`,
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
     VALUES (?1, ?2, ?3, 200000, ?4, 'normal', ?5, ?5)`,
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
        amount: 200000,
        amount_ex_gst: 200000,
        status: "created",
        destination: "upi",
        speed: "normal",
      }),
      expect.objectContaining({
        kind: "payment",
        id: PAY_OLD,
        reference: "MM-2026-0001",
        amount: 3000000,
        amount_ex_gst: 3000000,
        gst_percent: 0,
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

// LIFE-07 and LIFE-14: a no-show and a credit never appeared in Payments, though each took or kept something.
describe("GET /api/payments, what else a visit took", () => {
  interface Body {
    entries: { id: string; no_show: unknown }[];
    credits: { event: string; visits: number; visit: { id: string } | null; source: string | null; no_show: unknown }[];
  }
  const payments = async () => (await get("/api/payments")).json<Body>();

  /** A visit Rohit was not home for, with the case the technician's close opened. */
  async function notHome(decision: "undecided" | "charged" | "waived") {
    await visit(VISIT, P1, null);
    await env.DB.batch([
      env.DB.prepare("UPDATE appointments SET status = 'terminated', fsm_status = 'Terminated'"),
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-1', ?1, 't1', '2026-09-10T04:32:00.000Z', 28.4, 77.0, 200, 1, '2026-09-10T04:32:00.000Z')`,
      ).bind(VISIT),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
           decision, created_at)
         VALUES ('case-1', 'checkin-1', ?1, '2026-09-10T04:32:00.000Z', '2026-09-10T04:47:00.000Z',
           '2026-09-10T04:48:00.000Z', ?2, '2026-09-10T04:48:00.000Z')`,
      ).bind(VISIT, decision),
    ]);
  }

  async function credits(...entries: [id: string, kind: string, visits: number, source: string, sourceId: string][]) {
    await env.DB.batch(
      entries.map(([id, kind, visits, source, sourceId], index) =>
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, expires_at,
             created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        ).bind(
          id,
          P1,
          kind,
          visits,
          kind === "grant" ? null : "grant-1",
          source,
          sourceId,
          kind === "grant" ? "2027-09-01T18:29:59.999Z" : null,
          `2026-09-0${String(index + 1)}T06:00:00.000Z`,
        ),
      ),
    );
  }

  it("says of a visit's payment that nobody was home, how long we waited, and the ruling", async () => {
    await notHome("charged");
    await payment(PAY_OLD, P1, VISIT, "2026-09-01T06:00:00.000Z");
    expect((await payments()).entries).toEqual([
      // Charged before a charge recorded what it took, so there is nothing to dispute.
      expect.objectContaining({
        id: PAY_OLD,
        no_show: { decision: "charged", waited_minutes: 16, charge: null, dispute: null, disputable: false },
      }),
    ]);
  });

  it("lists every change to the credits, newest first, each with the visit it was for", async () => {
    await visit(VISIT, P1, null);
    await credits(["grant-1", "grant", 3, "referral", "referral-1"], ["redeem-1", "redeem", -1, "appointment", VISIT]);
    expect((await payments()).credits).toEqual([
      {
        id: "redeem-1",
        date: "2026-09-02",
        event: "used",
        visits: -1,
        visit: { id: VISIT, date: "2026-09-10", type: "first_fit" },
        source: null,
        no_show: null,
      },
      { id: "grant-1", date: "2026-09-01", event: "added", visits: 3, visit: null, source: "referral", no_show: null },
    ]);
  });

  it("says a credit is lost on a visit cancelled inside 24 hours, and back on one cancelled in time", async () => {
    await visit(VISIT, P1, null);
    await credits(["grant-1", "grant", 3, "referral", "referral-1"], ["redeem-1", "redeem", -1, "appointment", VISIT]);
    await env.DB.prepare(
      `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, created_at)
       VALUES ('c1', ?1, ?2, 'cancelled', 'late', '2026-09-10T04:30:00.000Z', 0, ?3)`,
    )
      .bind(VISIT, P1, NOW.toISOString())
      .run();
    expect((await payments()).credits[0]).toMatchObject({ id: "redeem-1", event: "lost" });

    await env.DB.prepare("UPDATE visit_changes SET notice = 'free'").run();
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('restore-1', ?1, 'restore', 1, 'grant-1', 'appointment', ?2, '2026-09-05T06:00:00.000Z')`,
    )
      .bind(P1, VISIT)
      .run();
    expect((await payments()).credits.map((line) => line.event)).toEqual(["returned", "used", "added"]);
  });

  it("says a credit is lost on a no-show ops charged", async () => {
    await notHome("charged");
    await credits(["grant-1", "grant", 3, "referral", "referral-1"], ["redeem-1", "redeem", -1, "appointment", VISIT]);
    expect((await payments()).credits[0]).toMatchObject({
      event: "lost",
      no_show: { decision: "charged", waited_minutes: 16 },
    });
  });

  // A charge of nothing, or a disputed charge ops refunded, gives the credit back
  // (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md): it was used, and returned, never lost.
  it("says a credit a charged no-show gave back was used, then returned", async () => {
    await notHome("charged");
    await credits(
      ["grant-1", "grant", 3, "referral", "referral-1"],
      ["redeem-1", "redeem", -1, "appointment", VISIT],
      ["restore-1", "restore", 1, "appointment", VISIT],
    );
    expect((await payments()).credits.map((line) => line.event)).toEqual(["returned", "used", "added"]);
  });
});

describe("GET /api/payments/:id/receipt", () => {
  const recorded = (id: string, booksPaymentId: string) =>
    env.DB.prepare("UPDATE payments SET books_payment_id = ?1 WHERE id = ?2").bind(booksPaymentId, id).run();

  it("offers the receipt once Books has the payment, and streams it", async () => {
    await payment(PAY_OLD, P1, null, "2026-09-01T06:00:00.000Z");
    expect((await get(`/api/payments/${PAY_OLD}/receipt`)).status).toBe(409);
    await recorded(PAY_OLD, "stub-payment-1");
    expect(await (await get(`/api/payments/${PAY_OLD}`)).json()).toMatchObject({
      documents: { invoice: null, receipt: PAY_OLD },
    });
    const response = await get(`/api/payments/${PAY_OLD}/receipt`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="receipt.pdf"');
    expect(await response.text()).toMatch(/^%PDF-1\.4/);
  });

  it("says not ready while Books cannot find it, and not found for another client's payment", async () => {
    await payment(PAY_OLD, P1, null, "2026-09-01T06:00:00.000Z");
    await recorded(PAY_OLD, "gone-1");
    expect((await get(`/api/payments/${PAY_OLD}/receipt`)).status).toBe(409);
    await person("p2", "+919810000002");
    await payment(PAY_NEW, "p2", null, "2026-09-01T06:00:00.000Z");
    await recorded(PAY_NEW, "stub-payment-2");
    expect((await get(`/api/payments/${PAY_NEW}/receipt`)).status).toBe(404);
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

  // A draft can still be edited, renumbered or deleted, so it is not a document the client may open (ADR 0056).
  it("says not ready while the invoice Books holds is still a draft", async () => {
    await visit(VISIT, P1, "stub-41", false);
    await payment(PAY_OLD, P1, VISIT, "2026-09-01T06:00:00.000Z");
    expect((await get(`/api/documents/${VISIT}`)).status).toBe(409);
    expect(await (await get(`/api/payments/${PAY_OLD}`)).json()).toMatchObject({ documents: { invoice: null } });
  });
});

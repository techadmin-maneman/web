// One client's record on the ops surface (src/routes/ops/clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import {
  PERSON,
  UNKNOWN,
  VISIT,
  UPCOMING,
  FRONT,
  PAYMENT,
  MOBILE,
  person,
  record,
  upcomingVisit,
} from "./ops-clients-fixtures.ts";

let ops: App;

interface ClientBody {
  address: Record<string, unknown> | null;
  visits: { upcoming: { price_open: boolean }[]; past: { id: string; closed_without_follow_up: unknown }[] };
}

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", MOBILE);
});

describe("GET /api/clients/{id}", () => {
  it("gives ops the client, their address, their visits with technician and outcome, and their payments", async () => {
    await record();
    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<Record<string, never>>();

    expect(body).toMatchObject({
      id: PERSON,
      name: "Rohit Malhotra",
      mobile: MOBILE,
      state: "fitted",
      known_since: "2026-08-01T06:00:00.000Z",
      address: {
        line1: "House 7",
        locality: "Sector 65",
        city: "Gurgaon",
        pincode: "122018",
        access_notes: "Gate 4417, visitor bay B",
      },
      credits: { visits: 2 },
      payments: [{ kind: "payment", id: PAYMENT, reference: "MM-2026-0841", amount: 236000 }],
    });
    expect(body.visits).toEqual({
      upcoming: [],
      past: [
        expect.objectContaining({
          id: VISIT,
          date: "2026-09-10",
          type: "service",
          status: "completed",
          outcome: "partial",
          technician: { name: "Imran Qureshi", initials: "IQ" },
          place: "Sector 65, Gurgaon 122018",
        }),
      ],
    });
  });

  // Ops close a visit left partly done without a follow-up, with why (docs/decisions/0092-task-owners.md).
  it("says who closed a visit left partly done without a follow-up, when and why", async () => {
    await record();
    const unclosed = await (await request(ops, `/api/clients/${PERSON}`)).json<ClientBody>();
    expect(unclosed.visits.past[0]?.closed_without_follow_up).toBeNull();

    await env.DB.prepare(
      `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
       VALUES ('closing-1', 'partial_visit', ?1, 'Wants no more visits this year', 'priya@maneman.in', ?2)`,
    )
      .bind(VISIT, NOW.toISOString())
      .run();
    const closed = await (await request(ops, `/api/clients/${PERSON}`)).json<ClientBody>();
    expect(closed.visits.past[0]?.closed_without_follow_up).toEqual({
      by: "priya@maneman.in",
      at: NOW.toISOString(),
      reason: "Wants no more visits this year",
    });
  });

  // A refund the booking made by itself showed nowhere in the console.
  it("lists a booking that refunded its payment by itself, and why, and none that ops refunded", async () => {
    await record();
    const refundedAt = "2026-09-21T06:43:00.000Z";
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, expires_at, created_at, updated_at, razorpay_order_id, refunded_at, auto_refund_reason)
       VALUES ('hold-lapsed', ?1, 'service', '2026-09-22', 'afternoon', 't1', 6, 236000, 200000, 18, 'released', ?2, ?2,
         ?3, 'order_late', ?3, 'lapsed'),
              ('hold-by-ops', ?1, 'service', '2026-09-23', 'morning', 't1', 0, 236000, 200000, 18, 'released', ?2, ?2,
         ?3, NULL, ?3, NULL)`,
    )
      .bind(PERSON, "2026-09-21T06:30:00.000Z", refundedAt)
      .run();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, method, status,
         created_at, updated_at)
       VALUES ('pay-late', ?1, 'order_late', 'pay_late', 236000, 'INR', 'upi', 'refunded', ?2, ?2)`,
    )
      .bind(PERSON, "2026-09-21T06:43:00.000Z")
      .run();

    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<{ auto_refunds: unknown }>();
    expect(body.auto_refunds).toEqual([
      {
        hold_id: "hold-lapsed",
        type: "service",
        service: "Service visit",
        date: "2026-09-22",
        amount: 236000,
        reason: "lapsed",
        refunded_at: refundedAt,
      },
    ]);
  });

  it("reads nothing booked and no address for a client with only a record", async () => {
    const body = await (await request(ops, `/api/clients/${PERSON}`)).json();
    expect(body).toMatchObject({
      state: "nothing_booked",
      address: null,
      credits: null,
      visits: { upcoming: [], past: [] },
      payments: [],
    });
  });

  // A live test, 4 October 2026: a client whose booking was refunded read "Booked" with nothing booked.
  it("reads booked only while a visit is to come, not for a booking the site's form left that booked nothing", async () => {
    await env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, city, proposed_visit_date, request_id)
       VALUES ('l-1', ?1, ?2, 'form', 'Gurgaon', '2026-09-24', 'r')`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const stateNow = async () => (await (await request(ops, `/api/clients/${PERSON}`)).json<{ state: string }>()).state;
    expect(await stateNow()).toBe("nothing_booked");

    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         service_city, service_pincode, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-2', ?2, 'consultation', 'scheduled', 'Scheduled', '2026-09-24T04:30:00.000Z',
         '2026-09-24T05:30:00.000Z', 'Gurgaon', '122018', ?3, ?3)`,
    )
      .bind(VISIT, PERSON, NOW.toISOString())
      .run();
    expect(await stateNow()).toBe("lead");
  });

  it("answers 404 for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}`);
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
  });

  // An erased client's page read "We could not load this", and
  // the alerts that linked to it led nowhere.
  it("answers what is kept of a client once erased: when, their visits and their money, nothing naming them", async () => {
    await record();
    await upcomingVisit();
    const before = await (await request(ops, `/api/clients/${PERSON}`)).json<ClientBody>();
    expect(before.visits.upcoming[0]?.price_open).toBe(true);
    const erased = await request(
      ops,
      `/api/clients/${PERSON}/erasure`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ override_open_bookings: true }),
      },
      { CRM_QUEUE: fakeQueue() },
    );
    expect(erased.status).toBe(200);

    const answer = await request(ops, `/api/clients/${PERSON}`);
    expect(answer.status).toBe(200);
    const body = await answer.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["erased_at", "id", "invoices", "payment_links", "payments", "visits"]);
    expect(body).toMatchObject({
      id: PERSON,
      erased_at: NOW.toISOString(),
      // The visit still to come is kept for ops to cancel by hand; neither visit takes a discount code any more.
      visits: {
        upcoming: [expect.objectContaining({ id: UPCOMING, stage: "booked", price_open: false })],
        past: [expect.objectContaining({ id: VISIT, outcome: "partial", price_open: false })],
      },
      payments: [{ kind: "payment", id: PAYMENT, reference: "MM-2026-0841", amount: 236000 }],
    });
    const written = JSON.stringify(body);
    for (const personal of ["Rohit", MOBILE, "House 7", "Gate 4417", "erased:"]) {
      expect(written, personal).not.toContain(personal);
    }
  });

  it("still finds no photographs or consents of a client once erased", async () => {
    await record();
    await env.DB.prepare("UPDATE people SET erased_at = ?2, name = 'Erased' WHERE id = ?1")
      .bind(PERSON, NOW.toISOString())
      .run();
    for (const path of ["/photos", "/consents"]) {
      expect((await request(ops, `/api/clients/${PERSON}${path}`)).status, path).toBe(404);
    }
    expect((await request(ops, `/api/clients/${PERSON}/photos/${FRONT}`)).status).toBe(404);
  });

  it("is refused, and audits nothing, without an Access identity", async () => {
    const refused = appFor(
      "local",
      fakeDependencies({ access: { verify: () => Promise.resolve({ ok: false, reason: "missing" }) } }),
      {},
      "ops",
    );
    const answer = await request(refused, `/api/clients/${PERSON}`);
    expect(answer.status).toBe(403);
    expect(await answer.json()).toMatchObject({ error: { code: "access_required" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS rows FROM audit_log").first<{ rows: number }>()).toEqual({
      rows: 0,
    });
  });
});

// The Payments tab showed neither a payment link nor an invoice, and a
// client who lost Razorpay's text could not be sent the link again.
describe("GET /api/clients/{id}, its payment links and invoices", () => {
  const FIT = "22222222-2222-4222-8222-222222222223";
  const CONSULTATION = "22222222-2222-4222-8222-222222222224";
  const ONE_VISIT_LINK = "66666666-6666-4666-8666-666666666661";
  const PAID_HOLD = "66666666-6666-4666-8666-666666666662";
  const LAPSED_HOLD = "66666666-6666-4666-8666-666666666663";

  async function finishedVisit(id: string, type: string, start: string, oneVisit: string | null = null) {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, fsm_status, window_start, window_end,
         technician_id, service_city, service_pincode, fsm_modified_at, synced_at, one_visit)
       VALUES (?1, ?2, ?3, ?4, 'natural', 'completed', 'Completed', ?5, ?5, 't1', 'Gurgaon', '122018', ?6, ?6, ?7)`,
    )
      .bind(id, `fsm-${id}`, PERSON, type, start, NOW.toISOString(), oneVisit)
      .run();
  }

  async function linkHold(id: string, state: "booked" | "released", order: string | null, created: string) {
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, razorpay_order_id, expires_at, created_at, updated_at, pay_by_link,
         payment_link_id, payment_link_url, reference)
       VALUES (?1, ?2, 'service', '2026-09-25', 'morning', 't1', 0, 200000, 200000, 0, ?3, ?4, ?5, ?5, ?5, 1,
         ?6, ?7, ?8)`,
    )
      .bind(
        id,
        PERSON,
        state,
        order,
        created,
        `plink_${id}`,
        `https://rzp.io/i/${id.slice(0, 6)}`,
        `MM-2026-${id.slice(-4)}`,
      )
      .run();
  }

  beforeEach(async () => {
    await record();
    await env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', 'natural', 'Natural hair system', 180, 1, 'ops@localhost', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
  });

  it("lists every payment link, newest first: what it is for, its amount, its address while open, and if paid", async () => {
    await finishedVisit(FIT, "first_fit", "2026-09-18T04:30:00.000Z", "fitted");
    await env.DB.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
         short_url, sent_at, reference, created_at, updated_at)
       VALUES (?1, ?2, 'natural', 3540000, 3000000, 18, 'plink_fit', 'https://rzp.io/i/fit901', ?3, 'MM-2026-0901',
         ?3, ?3)`,
    )
      .bind(ONE_VISIT_LINK, FIT, "2026-09-18T08:00:00.000Z")
      .run();
    await linkHold(PAID_HOLD, "booked", "order_link_1", "2026-09-19T06:00:00.000Z");
    await env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, razorpay_order_id, amount, currency,
         method, status, created_at, updated_at)
       VALUES ('77777777-7777-4777-8777-777777777771', 'MM-2026-0662', ?1, 'pay_link_1', 'order_link_1', 200000,
         'INR', 'upi', 'captured', ?2, ?2)`,
    )
      .bind(PERSON, "2026-09-19T07:15:00.000Z")
      .run();
    await linkHold(LAPSED_HOLD, "released", null, "2026-09-17T06:00:00.000Z");

    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<{ payment_links: unknown[] }>();
    expect(body.payment_links).toEqual([
      {
        id: PAID_HOLD,
        product: "Service visit",
        visit_date: "2026-09-25",
        amount: 200000,
        reference: "MM-2026-6662",
        short_url: "https://rzp.io/i/666666",
        sent_at: "2026-09-19T06:00:00.000Z",
        state: "paid",
        paid_at: "2026-09-19T07:15:00.000Z",
      },
      {
        id: ONE_VISIT_LINK,
        product: "Natural hair system",
        visit_date: "2026-09-18",
        amount: 3540000,
        reference: "MM-2026-0901",
        short_url: "https://rzp.io/i/fit901",
        sent_at: "2026-09-18T08:00:00.000Z",
        state: "open",
        paid_at: null,
      },
      expect.objectContaining({ id: LAPSED_HOLD, state: "lapsed", paid_at: null }),
    ]);
  });

  // A one visit's link closes 14 days after Razorpay made it.
  it("says a one visit's link closed unpaid once its 14 days are up", async () => {
    await finishedVisit(FIT, "first_fit", "2026-09-04T04:30:00.000Z", "fitted");
    await env.DB.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
         short_url, sent_at, reference, created_at, updated_at)
       VALUES (?1, ?2, 'natural', 3540000, 3000000, 18, 'plink_fit', 'https://rzp.io/i/fit901', ?3, 'MM-2026-0901',
         ?3, ?3)`,
    )
      .bind(ONE_VISIT_LINK, FIT, "2026-09-07T06:30:00.000Z")
      .run();
    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<{ payment_links: unknown[] }>();
    expect(body.payment_links).toEqual([expect.objectContaining({ id: ONE_VISIT_LINK, state: "lapsed" })]);
  });

  it("says a link Razorpay has not made yet is being made, and one it refused was refused", async () => {
    await finishedVisit(FIT, "first_fit", "2026-09-18T04:30:00.000Z", "fitted");
    await env.DB.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, created_at, updated_at)
       VALUES (?1, ?2, 'natural', 3540000, 3000000, 18, ?3, ?3)`,
    )
      .bind(ONE_VISIT_LINK, FIT, NOW.toISOString())
      .run();
    const making = await (await request(ops, `/api/clients/${PERSON}`)).json<{ payment_links: unknown[] }>();
    expect(making.payment_links).toEqual([
      expect.objectContaining({ state: "making", short_url: null, sent_at: null, reference: null }),
    ]);

    await env.DB.prepare("UPDATE payment_links SET refused_at = ?1").bind(NOW.toISOString()).run();
    const refused = await (await request(ops, `/api/clients/${PERSON}`)).json<{ payment_links: unknown[] }>();
    expect(refused.payment_links).toEqual([expect.objectContaining({ state: "refused" })]);
  });

  it("gives each finished visit sold for a price its invoice's state, and leaves out a free consultation", async () => {
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'books-1', invoice_issued_at = ?2 WHERE id = ?1")
      .bind(VISIT, "2026-09-10T09:00:00.000Z")
      .run();
    await finishedVisit(FIT, "first_fit", "2026-09-18T04:30:00.000Z");
    await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = 'books-2' WHERE id = ?1").bind(FIT).run();
    await finishedVisit(CONSULTATION, "consultation", "2026-09-05T04:30:00.000Z");
    const declined = "22222222-2222-4222-8222-222222222225";
    await finishedVisit(declined, "first_fit", "2026-09-19T04:30:00.000Z", "declined");
    const toRaise = "22222222-2222-4222-8222-222222222226";
    await finishedVisit(toRaise, "replacement", "2026-09-20T04:30:00.000Z");

    const body = await (await request(ops, `/api/clients/${PERSON}`)).json<{ invoices: unknown[] }>();
    expect(body.invoices).toEqual([
      { visit_id: toRaise, date: "2026-09-20", type: "replacement", state: "to_raise", issued_at: null },
      { visit_id: FIT, date: "2026-09-18", type: "first_fit", state: "draft", issued_at: null },
      { visit_id: VISIT, date: "2026-09-10", type: "service", state: "issued", issued_at: "2026-09-10T09:00:00.000Z" },
    ]);
  });
});

// One client's record on the ops surface (src/routes/ops-clients.ts): the client
// page, its photographs and its consents, Ops Console B1 to B3. NOW is Monday
// 21 September 2026, 12 noon in India. Every name, number and photograph is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { grantCredits } from "../../src/domain/credits.ts";
import { PHOTO_VIEW_MINUTES } from "../../src/domain/photo-views.ts";
import { CLIENTS_FOUND } from "../../src/routes/ops-clients.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";
const VISIT = "22222222-2222-4222-8222-222222222222";
const UPCOMING = "22222222-2222-4222-8222-222222222229";
const SET = "33333333-3333-4333-8333-333333333333";
const FRONT = "44444444-4444-4444-8444-444444444441";
const TOP = "44444444-4444-4444-8444-444444444442";
const PAYMENT = "55555555-5555-4555-8555-555555555555";
const MOBILE = "+919810000001";

let ops: App;

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, "2026-08-01T06:00:00.000Z", mobile, name)
    .run();
}

/** A finished service visit with a technician, an address, two photographs, a payment and a credit. */
async function record() {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-10T04:30:00.000Z',
       '2026-09-10T07:30:00.000Z', 't1', 'Gurgaon', '122018', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    "INSERT INTO visits (id, appointment_id, outcome, duration_minutes, updated_at) VALUES ('v1', ?1, 'partial', 95, ?2)",
  )
    .bind(VISIT, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes)
     VALUES ('addr-1', ?1, ?2, 'House 7', NULL, 'Sector 65', 'Gurgaon', '122018', 'Gate 4417, visitor bay B')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, 'after', ?3)")
    .bind(SET, VISIT, NOW.toISOString())
    .run();
  for (const [id, angle] of [
    [TOP, "top"],
    [FRONT, "front"],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, 'image/jpeg', 3, 600, 800, ?5, ?5)`,
    )
      .bind(id, SET, angle, `visits/${VISIT}/after-${angle}.jpg`, NOW.toISOString())
      .run();
    await env.CLIENT_PHOTOS.put(`visits/${VISIT}/after-${angle}.jpg`, new Uint8Array([1, 2, 3]));
  }
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_1', 236000, 'INR', 'upi', 'captured', ?4, ?4)`,
  )
    .bind(PAYMENT, PERSON, VISIT, "2026-09-09T06:00:00.000Z")
    .run();
  await grantCredits(env.DB, { personId: PERSON, visits: 2, source: "ops", sourceId: "o1", now: NOW }).run();
}

/** A service visit on Friday the 25th, booked and not yet paid for. */
async function upcomingVisit() {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, fsm_status, window_start, window_end,
       technician_id, service_city, service_pincode, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-2', ?2, 'service', 'natural', 'scheduled', 'Scheduled', '2026-09-25T04:30:00.000Z',
       '2026-09-25T07:30:00.000Z', 't1', 'Gurgaon', '122018', ?3, ?3)`,
  )
    .bind(UPCOMING, PERSON, NOW.toISOString())
    .run();
}

async function consent(purpose: string, granted: 0 | 1, notice: string, at: string, source: string | null = null) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(crypto.randomUUID(), PERSON, purpose, notice, granted, at, source)
    .run();
}

interface ClientBody {
  address: Record<string, unknown> | null;
  visits: { upcoming: { price_open: boolean }[]; past: { id: string; closed_without_follow_up: unknown }[] };
}

const auditRows = () =>
  env.DB.prepare("SELECT action, actor, subject_kind, subject_id, detail FROM audit_log WHERE action != 'ops.call'")
    .all<{ action: string; actor: string; subject_kind: string; subject_id: string; detail: string | null }>()
    .then((rows) => rows.results);

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

  it("answers 404 for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}`);
    expect(answer.status).toBe(404);
    expect(await answer.json()).toMatchObject({ error: { code: "not_found" } });
  });

  // PS-18, OIA-18 and CP-35 of the audit, 2 October 2026: an erased client's page read "We could not load this", and
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
      { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() },
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

// MON-16 and OIA-08 of the audit, 2 October 2026: the Payments tab showed neither a payment link nor an invoice, and a
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

describe("GET /api/clients/{id}/photos", () => {
  it("lists what there is by visit, in the design's angle order, and serves no image or key", async () => {
    await record();
    const body = await (
      await request(ops, `/api/clients/${PERSON}/photos`)
    ).json<{ visits: Record<string, never>[] }>();

    expect(body.visits).toEqual([
      {
        visit_id: VISIT,
        date: "2026-09-10",
        type: "service",
        technician: { name: "Imran Qureshi", initials: "IQ" },
        photos: [
          { id: FRONT, phase: "after", angle: "front", width: 600, height: 800, taken_at: NOW.toISOString() },
          { id: TOP, phase: "after", angle: "top", width: 600, height: 800, taken_at: NOW.toISOString() },
        ],
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("visits/");
    expect(await auditRows()).toEqual([]);
  });
});

/**
 * One opening of a client's photographs is one entry in the log, whose time is
 * the server's (OPS-17). It once wrote an entry for every image, ten for one
 * visit and ten more on every return to the tab, and the console lettered the
 * browser's own clock as the time it was logged.
 */
describe("POST /api/clients/{id}/photos/view", () => {
  const view = (app = ops) =>
    request(app, `/api/clients/${PERSON}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });

  it("writes one entry naming the staff and the client, and answers when it was logged", async () => {
    await record();
    const answer = await view();

    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [],
    });
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);
  });

  it("serves every photograph within the view, and writes nothing more for them", async () => {
    await record();
    await view();
    for (const photo of [FRONT, TOP]) {
      const answer = await request(ops, `/api/clients/${PERSON}/photos/${photo}`);
      expect(answer.status, photo).toBe(200);
      expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(await auditRows()).toHaveLength(1);
  });

  it("says who opened them before, the latest first", async () => {
    await record();
    const earlier = (minutes: number) =>
      appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() - minutes * 60_000) }), {}, "ops");
    await view(earlier(24 * 60));
    await view(earlier(90));

    expect(await (await view()).json()).toEqual({
      logged_at: NOW.toISOString(),
      before: [
        { by: "ops@localhost", at: new Date(NOW.getTime() - 90 * 60_000).toISOString() },
        { by: "ops@localhost", at: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString() },
      ],
    });
  });

  it("logs nothing for a client we do not have", async () => {
    const answer = await request(ops, `/api/clients/${UNKNOWN}/photos/view`, {
      method: "POST",
      headers: { Origin: "https://maneman.test" },
    });
    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });

  it("opens nothing when the view cannot be logged", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/view`,
      { method: "POST", headers: { Origin: "https://maneman.test" } },
      { DB: auditFailsFor(env.DB, "photo.view") },
    );
    expect(answer.status).toBe(503);
    expect(await auditRows()).toEqual([]);
  });
});

describe("GET /api/clients/{id}/photos/{photo_id}", () => {
  // The console always opens a view first; a photograph asked for outside one still never leaves unlogged.
  it("logs a view itself, before the image, when none by this member of staff is open", async () => {
    await record();
    const answer = await request(ops, `/api/clients/${PERSON}/photos/${FRONT}`);

    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("image/jpeg");
    expect(answer.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await auditRows()).toEqual([
      { action: "photo.view", actor: "ops@localhost", subject_kind: "person", subject_id: PERSON, detail: null },
    ]);

    // Within the view, the next one adds nothing; once the view has closed, it is logged again.
    await request(ops, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(1);
    const later = appFor(
      "local",
      fakeDependencies({ now: () => new Date(NOW.getTime() + (PHOTO_VIEW_MINUTES + 1) * 60_000) }),
      {},
      "ops",
    );
    await request(later, `/api/clients/${PERSON}/photos/${TOP}`);
    expect(await auditRows()).toHaveLength(2);
  });

  it("serves no photograph when the view cannot be audited", async () => {
    await record();
    const answer = await request(
      ops,
      `/api/clients/${PERSON}/photos/${FRONT}`,
      {},
      { DB: auditFailsFor(env.DB, "photo.view") },
    );

    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await auditRows()).toEqual([]);
  });

  it("answers 404, unaudited, for another client's photograph", async () => {
    await record();
    await person(OTHER, "Vikram Sethi", "+919810000002");
    const answer = await request(ops, `/api/clients/${OTHER}/photos/${FRONT}`);

    expect(answer.status).toBe(404);
    expect(await auditRows()).toEqual([]);
  });
});

describe("GET /api/clients/{id}/consents", () => {
  it("gives every purpose its state, notice version, date and where it was given, with any deletion request", async () => {
    await consent("photos_own_record", 1, "photos-own-record-booking-v1", "2026-08-02T06:00:00.000Z", "app_booking");
    await consent("photos_marketing", 1, "photos-marketing-v1", "2026-08-02T06:00:00.000Z");
    await consent("whatsapp_visits", 1, "whatsapp-visits-v1", "2026-08-02T06:00:00.000Z", "app_booking");
    await consent("whatsapp_visits", 0, "whatsapp-visits-v1", "2026-09-01T06:00:00.000Z", "app_profile");
    await env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')",
    )
      .bind("66666666-6666-4666-8666-666666666666", PERSON, NOW.toISOString())
      .run();

    const body = await (await request(ops, `/api/clients/${PERSON}/consents`)).json();
    expect(body).toEqual({
      consents: [
        {
          purpose: "photos_own_record",
          state: "given",
          notice_version: "photos-own-record-booking-v1",
          at: "2026-08-02T06:00:00.000Z",
          source: "app_booking",
        },
        { purpose: "photos_referral_cards", state: "not_given", notice_version: null, at: null, source: null },
        // Given before a consent recorded where, so it has no place (docs/decisions/0094-where-a-consent-was-given.md).
        {
          purpose: "photos_marketing",
          state: "given",
          notice_version: "photos-marketing-v1",
          at: "2026-08-02T06:00:00.000Z",
          source: null,
        },
        {
          purpose: "whatsapp_visits",
          state: "withdrawn",
          notice_version: "whatsapp-visits-v1",
          at: "2026-09-01T06:00:00.000Z",
          source: "app_profile",
        },
        { purpose: "whatsapp_launches", state: "not_given", notice_version: null, at: null, source: null },
      ],
      deletion: {
        id: "66666666-6666-4666-8666-666666666666",
        state: "requested",
        requested_at: NOW.toISOString(),
        decided_at: null,
      },
    });
  });
});

describe("POST /api/clients/search", () => {
  const search = (mobile: string) =>
    request(ops, "/api/clients/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ mobile }),
    });

  it("finds the client from a number typed any of the usual ways, and never puts it in the URL", async () => {
    const answer = await search("98100 00001");
    expect(await answer.json()).toEqual({ id: PERSON, name: "Rohit Malhotra", mobile: MOBILE });
  });

  it("answers 404 for a number we do not have, and 400 for one that is not a mobile number", async () => {
    expect((await search("9810000009")).status).toBe(404);
    const bad = await search("12345");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "invalid_request", fields: ["mobile"] } });
  });
});

// A client could be found only by typing their whole number exactly (OPS-04).
describe("POST /api/clients/find", () => {
  const find = (text: string) =>
    request(ops, "/api/clients/find", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ text }),
    });
  const found = async (text: string) =>
    (await (await find(text)).json<{ clients: { name: string }[]; more: boolean }>()).clients.map((each) => each.name);

  beforeEach(async () => {
    await person(OTHER, "Vikram Sethi", "+919810000002");
    await person("11111111-1111-4111-8111-111111111113", "Rohini Sethi", "+919820000003");
  });

  it("finds clients by any part of their name, whatever its case", async () => {
    expect(await found("sethi")).toEqual(["Rohini Sethi", "Vikram Sethi"]);
    expect(await found("ROH")).toEqual(["Rohini Sethi", "Rohit Malhotra"]);
    expect(await (await find("vikram")).json()).toEqual({
      clients: [{ id: OTHER, name: "Vikram Sethi", mobile: "+919810000002" }],
      more: false,
    });
  });

  it("finds clients by any four or more digits of their number, typed any of the usual ways", async () => {
    expect(await found("98100")).toEqual(["Rohit Malhotra", "Vikram Sethi"]);
    expect(await found("+91 98200-00003")).toEqual(["Rohini Sethi"]);
    expect(await found("098200 00003")).toEqual(["Rohini Sethi"]);
    expect(await found("0091 98200 00003")).toEqual(["Rohini Sethi"]);
  });

  it("treats a percent sign or an underscore as itself, not as a wildcard", async () => {
    expect(await found("%%")).toEqual([]);
    expect(await found("R_hit")).toEqual([]);
  });

  it("leaves out an erased client", async () => {
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), OTHER).run();
    expect(await found("sethi")).toEqual(["Rohini Sethi"]);
  });

  it("lists a page at most, and says there are more", async () => {
    await env.DB.batch(
      Array.from({ length: CLIENTS_FOUND + 1 }, (_, n) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`,
          NOW.toISOString(),
          `+9197000${String(n).padStart(5, "0")}`,
          `Kumar ${String(n).padStart(2, "0")}`,
        ),
      ),
    );
    const body = await (await find("kumar")).json<{ clients: unknown[]; more: boolean }>();
    expect(body.clients).toHaveLength(CLIENTS_FOUND);
    expect(body.more).toBe(true);
  });

  it("asks for two letters or four digits at least", async () => {
    for (const text of ["r", "981", "  "]) {
      const answer = await find(text);
      expect(answer.status, text).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["text"] } });
    }
  });
});

/** A database whose audit writes for one action fail, to prove nothing audited happens unaudited. */
function auditFailsFor(db: D1Database, action: string): D1Database {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "prepare") return Reflect.get(target, property, receiver) as unknown;
      return (sql: string): D1PreparedStatement => {
        const statement = target.prepare(sql);
        if (!/INSERT INTO audit_log/i.test(sql)) return statement;
        return new Proxy(statement, {
          get(inner, key, self) {
            if (key !== "bind") return Reflect.get(inner, key, self) as unknown;
            return (...values: unknown[]): D1PreparedStatement =>
              values.includes(action)
                ? ({ run: () => Promise.reject(new Error("D1_ERROR: simulated write failure")) } as D1PreparedStatement)
                : inner.bind(...values);
          },
        });
      };
    },
  });
}

// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { appFor, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const VISITOR = {
  name: "Karan Bhatia",
  mobile: "9810000002",
  loss_extent: "crown",
  turnstile_token: "token",
};

const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function pincode(pin: string, area: string, city: string, served: boolean) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(pin, area, city, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

describe("POST /api/consultation", () => {
  it("holds the slot, tells FSM, and leaves the lead the CRM syncs", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fsm, CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
    });
    expect(fsm.sent).toEqual([{ hold_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    expect(crm.sent).toEqual([{ lead_id: expect.any(String) as string, request_id: expect.any(String) as string }]);

    const booked = await env.DB.prepare(
      `SELECT p.name, c.purpose, c.notice_version, h.type, h.amount, l.source, l.loss_extent,
         l.proposed_visit_date, l.first_choice_window, l.city
       FROM people p
       JOIN consents c ON c.person_id = p.id
       JOIN slot_holds h ON h.person_id = p.id
       JOIN leads l ON l.person_id = p.id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(booked).toEqual({
      name: "Karan Bhatia",
      purpose: "whatsapp_visits",
      notice_version: "referral-consultation-v1",
      type: "consultation",
      amount: 0,
      source: "form",
      loss_extent: "crown",
      // The date they chose, not a guess, and no rough window: the booking has a real one.
      proposed_visit_date: "2026-09-23",
      first_choice_window: null,
      city: "Gurgaon",
    });
  });

  it("refuses a pincode we do not serve, and a day outside the fortnight", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = { ...VISITOR, date: "2026-09-23", window: "morning", consent: true };

    expect((await request(site(), "/api/consultation", post({ ...body, pincode: "400050" }))).status).toBe(422);
    expect(
      (await request(site(), "/api/consultation", post({ ...body, pincode: "122018", date: "2026-09-21" }))).status,
    ).toBe(422);
    expect(
      (await request(site(), "/api/consultation", post({ ...body, pincode: "122018", date: "2026-10-31" }))).status,
    ).toBe(422);
  });

  // Ops fix the hour on WhatsApp while the flag is off, so the day the visitor
  // asked for is recorded for them instead of being refused
  // (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
  it("records a request for ops while self-serve booking is off, holding no slot", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await request(
      site({ selfServeBooking: false }),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fsm, CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "requested",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
    });
    expect(fsm.sent).toEqual([]);
    expect(crm.sent).toHaveLength(1);
    const asked = await env.DB.prepare(
      `SELECT r.pincode, r.requested_date, r.requested_window, r.referral_code
       FROM consultation_requests r JOIN people p ON p.id = r.person_id WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(asked).toEqual({
      pincode: "122018",
      requested_date: "2026-09-23",
      requested_window: "morning",
      referral_code: null,
    });
  });
});

describe("POST /api/waitlist", () => {
  it("takes the number for a pincode we do not serve, with the launch alert asked for", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: true }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ area: "Bandra" });
    const listed = await env.DB.prepare(
      `SELECT w.pincode, w.launch_alert, w.referral_code, l.source, l.proposed_visit_date
       FROM waitlist_entries w JOIN people p ON p.id = w.person_id JOIN leads l ON l.person_id = p.id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(listed).toEqual({
      pincode: "400050",
      launch_alert: 1,
      referral_code: null,
      source: "waitlist",
      proposed_visit_date: null,
    });
    const consents = await env.DB.prepare(
      `SELECT purpose FROM consents c JOIN people p ON p.id = c.person_id
       WHERE p.mobile_e164 = '+919810000002' ORDER BY purpose`,
    ).all<{ purpose: string }>();
    expect(consents.results.map((row) => row.purpose)).toEqual(["contact", "whatsapp_launches"]);
  });

  it("refuses a pincode we do serve: that one books instead", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "122018", contact_consent: true, launch_alert: false }),
    );
    expect(answer.status).toBe(422);
  });
});

// A form anyone can fill in with a number (docs/decisions/0068-a-paid-hold-is-kept.md).
describe("a number the site already knows", () => {
  const book = (body: object, queue = fakeQueue()) =>
    request(site(), "/api/consultation", post({ ...VISITOR, pincode: "122018", consent: true, ...body }), {
      FSM_QUEUE: queue,
      CRM_QUEUE: fakeQueue(),
    });
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
  });

  it("is answered already_booked, with the day and window it has, rather than booked twice (CLI-02)", async () => {
    expect((await book({ date: "2026-09-23", window: "morning" })).status).toBe(201);
    const again = await book({ name: "Karan B. again", date: "2026-09-24", window: "evening" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: { code: "already_booked", request_id: expect.any(String) as string },
      booked: { date: "2026-09-23", window: "morning" },
    });
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
  });

  it("is never renamed by the form (BIZ-03)", async () => {
    await book({ date: "2026-09-23", window: "morning" });
    await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, name: "Somebody Else", pincode: "400050", contact_consent: true, launch_alert: false }),
    );
    expect(await env.DB.prepare("SELECT name FROM people").all()).toMatchObject({
      results: [{ name: "Karan Bhatia" }],
    });
  });

  it("books no consultation for a client past them, who books in the app (BIZ-03)", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p-fitted', ?1, '+919810000002', 'Karan Bhatia')",
    )
      .bind(NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at)
       VALUES ('fit', 'fsm-fit', 'p-fitted', 'first_fit', 'completed', 'Completed', '2026-08-01T03:30:00.000Z',
         '2026-08-01T06:30:00.000Z', ?1, ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(422);
    expect((await answer.json<{ error: { code: string } }>()).error.code).toBe("not_bookable");
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });

  it("leaves no person or consent behind when the window has gone (ARCH-05)", async () => {
    await env.DB.prepare("UPDATE technicians SET active = 0").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM people")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM consents")).toBe(0);
  });

  it("asks ops instead, holding nothing, on a day the price book charges for a consultation (BIZ-10)", async () => {
    await env.DB.prepare(
      "INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from) VALUES ('consultation', 'standard', 50000, 0, '2026-09-23')",
    ).run();
    const queue = fakeQueue();
    const answer = await book({ date: "2026-09-23", window: "morning" }, queue);
    expect(await answer.json()).toMatchObject({ state: "requested" });
    expect(queue.sent).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM consultation_requests")).toBe(1);
  });

  it("holds nothing on a day ops blacked out (BIZ-25)", async () => {
    await env.DB.prepare("INSERT INTO visit_blackouts (date, reason) VALUES ('2026-09-23', 'Dussehra')").run();
    const answer = await book({ date: "2026-09-23", window: "morning" });
    expect(answer.status).toBe(409);
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(0);
  });
});

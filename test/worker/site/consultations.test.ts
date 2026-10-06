// Booking from the public site (docs/decisions/0051-booking-from-the-site.md): the same path the
// referral landing takes, without an invite. NOW is Monday 21 September 2026, noon in India.
// Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consultationBody, lastBookableDay } from "../../../scripts/lib/test-booking.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { ADDRESS, pincode, VISITOR, post, site } from "./consultations-fixtures.ts";

/**
 * The most round trips to D1 a booking from the site may wait on in turn. It waited on 14 when each read waited for the
 * one before.
 */
const CONSULTATION_TRIPS = 9;

/** The round trips of the free booking written in the same request (src/http/book-hold.ts), which the form waits on. */
const BOOKING_TRIPS = 8;

beforeEach(async () => {
  await markDatabase();
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

describe("POST /api/consultation", () => {
  it("books the visit, and leaves the lead the CRM syncs", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const crm = fakeQueue();
    const answer = await request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: false,
      invite: "unknown",
      one_visit: false,
      discount_code: null,
    });
    expect(crm.sent).toEqual([{ lead_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    const visit = await env.DB.prepare("SELECT type, status, window_start FROM appointments").all();
    expect(visit.results).toEqual([
      { type: "consultation", status: "scheduled", window_start: "2026-09-23T03:30:00.000Z" },
    ]);

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
      notice_version: "site-consultation-v1",
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

  // Each D1 read is a round trip to the database's region, so the booking's reads that need nothing from each
  // other go together. The request's log line says how many it waited on.
  it("waits on few round trips to D1", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const logs = captureLogs();

    const answer = await request(
      site(),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: fakeQueue() },
    );
    const line = logs.lines().find((each) => each.event === "request");
    vi.restoreAllMocks();

    expect(answer.status).toBe(201);
    expect(line?.d1_trips).toBeLessThanOrEqual(CONSULTATION_TRIPS + BOOKING_TRIPS);
  });

  // The staging check and the load test book this way (scripts/staging/staging-lead.ts, scripts/staging/load-test-leads.ts).
  it("takes the booking a script sends on staging, with Cloudflare's dummy token", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = consultationBody({
      name: "Staging test",
      mobile: "9810000009",
      pincode: "122018",
      city: "Gurgaon",
      date: lastBookableDay(NOW),
      window: "evening",
    });
    const staging = site({ turnstileSecret: "0x4AAAAAAA-the-real-widget-secret", acceptTurnstileTestToken: true });

    const answer = await request(staging, "/api/consultation", post(body), {
      CRM_QUEUE: fakeQueue(),
    });

    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", date: "2026-10-05", window: "evening" });
  });

  // As the landing answers them, and as the form words them: "That day is no longer open" (open point 105).
  it("refuses a pincode we do not serve, and a day outside the fortnight, as not bookable", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = { ...VISITOR, date: "2026-09-23", window: "morning", consent: true, address: ADDRESS };

    for (const refused of [
      { ...body, pincode: "400050" },
      { ...body, pincode: "122018", date: "2026-09-21" },
      { ...body, pincode: "122018", date: "2026-10-31" },
    ]) {
      const answer = await request(site(), "/api/consultation", post(refused));
      expect(answer.status).toBe(422);
      expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
    }
  });

  // Our WhatsApp messages greet people by this name, so it is never a link or a number.
  it("refuses a name that is not letters, naming it, and books nothing", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const body = {
      ...VISITOR,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };

    for (const name of ["Win at example.com", "https://x.co", "Asha 2"]) {
      const answer = await request(site(), "/api/consultation", post({ ...body, name }));
      expect(answer.status).toBe(400);
      expect(await answer.json()).toMatchObject({ error: { code: "invalid_request", fields: ["name"] } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM people").first()).toEqual({ n: 0 });
  });

  // Ops fix the hour on WhatsApp while the flag is off, so the day the visitor
  // asked for is recorded for them instead of being refused
  // (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
  it("records a request for ops while self-serve booking is off, holding no slot", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const crm = fakeQueue();
    const answer = await request(
      site({ selfServeBooking: false }),
      "/api/consultation",
      post({ ...VISITOR, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "requested",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: false,
      invite: "unknown",
      one_visit: false,
      discount_code: null,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments").first()).toEqual({ n: 0 });
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
    // No slot, no confirmation: the load test (scripts/staging/load-test-leads.ts) runs with self-serve booking off
    // precisely so its random test numbers are never messaged (docs/decisions/0025-phase-2-conflicts-register.md,
    // item 84's refinement).
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM outbound_messages").first()).toEqual({ n: 0 });
  });
});

// An area nobody had named was called by its post office's name.
describe("an area ops have not named yet", () => {
  it("is booked as its city", async () => {
    await pincode("110048", "Masjid Moth", "Delhi", true, false);
    const answer = await request(
      site(),
      "/api/consultation",
      post({
        ...VISITOR,
        pincode: "110048",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: { ...ADDRESS, locality: "Greater Kailash II", city: "Delhi", pincode: "110048" },
      }),
      { CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toMatchObject({ state: "booked", area: "Delhi" });
  });

  it("is not named to someone joining its waitlist", async () => {
    await pincode("110048", "Masjid Moth", "Delhi", false, false);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "110048", contact_consent: true, launch_alert: false }),
      { CRM_QUEUE: fakeQueue() },
    );
    expect(await answer.json()).toEqual({ area: null, credits: false, invite: "unknown" });
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
    expect(await answer.json()).toEqual({ area: "Bandra", credits: false, invite: "unknown" });
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
      `SELECT purpose, source FROM consents c JOIN people p ON p.id = c.person_id
       WHERE p.mobile_e164 = '+919810000002' ORDER BY purpose`,
    ).all();
    expect(consents.results).toEqual([
      { purpose: "contact", source: "site_waitlist" },
      { purpose: "whatsapp_launches", source: "site_waitlist" },
    ]);
  });

  // ADR 0041 lists the waitlist confirmation among the app's messages; nothing wrote one.
  it("queues one WhatsApp confirming the place on the list, however often the number joins", async () => {
    await pincode("400050", "Bandra", "Mumbai", false);
    const messages = fakeQueue();
    const join = () =>
      request(
        site(),
        "/api/waitlist",
        post({ ...VISITOR, pincode: "400050", contact_consent: true, launch_alert: false }),
        {
          CRM_QUEUE: fakeQueue(),
          MESSAGE_QUEUE: messages,
        },
      );

    expect((await join()).status).toBe(201);
    expect((await join()).status).toBe(201);

    const queued = await env.DB.prepare(
      `SELECT m.id, m.kind, m.subject_kind, m.state, m.subject_id = w.id AS about_the_entry
       FROM outbound_messages m JOIN waitlist_entries w ON w.person_id = m.person_id`,
    ).all();
    expect(queued.results).toEqual([
      {
        id: expect.any(String) as string,
        kind: "waitlist_confirmation",
        subject_kind: "waitlist_entry",
        state: "queued",
        about_the_entry: 1,
      },
    ]);
    expect(messages.sent).toEqual([{ message_id: queued.results[0]?.id, request_id: expect.any(String) as string }]);
  });

  it("refuses a pincode we do serve: that one books instead", async () => {
    await pincode("122018", "Gurgaon South City II", "Gurgaon", true);
    const answer = await request(
      site(),
      "/api/waitlist",
      post({ ...VISITOR, pincode: "122018", contact_consent: true, launch_alert: false }),
    );
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({ error: { code: "not_bookable" } });
  });
});

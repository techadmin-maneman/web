// Referral codes, the landing's APIs, the waitlist and the credit ledger (docs/decisions/0048-referrals.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, provedNumberCode, request } from "../helpers.ts";
import { REFERRER, person, pincode, client, site, codeOf, post, FRIEND, ADDRESS } from "./referrals-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await person(REFERRER, "Rohit Malhotra", "+919810000001");
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

describe("POST /api/r/:code/consultation", () => {
  it("books a free consultation for a new friend, who carries the invite's credits", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: true,
      invite: "valid",
      one_visit: false,
    });
    const friend = await env.DB.prepare(
      `SELECT p.name, c.purpose, c.notice_version, c.source, r.code, r.via, r.grant_state, h.type, h.amount, h.state
       FROM people p JOIN consents c ON c.person_id = p.id JOIN referral_attributions r ON r.referred_person_id = p.id
       JOIN slot_holds h ON h.person_id = p.id WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(friend).toEqual({
      name: "Karan Bhatia",
      purpose: "whatsapp_visits",
      notice_version: "referral-consultation-v1",
      source: "referral_landing",
      code,
      via: "consultation",
      grant_state: "pending",
      type: "consultation",
      amount: 0,
      state: "booked",
    });
  });

  it("gives no credits to the referrer using their own invite, or to someone already fitted", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const self = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({
        ...FRIEND,
        mobile: "98100 00001",
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
      }),
    );
    // Refer is a fitted client's, so the referrer is a number we know: told what a new number would be, so the page
    // never says it is known, and attributed nothing.
    expect(self.status).toBe(201);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM referral_attributions").first()).toEqual({ n: 0 });
    const unknown = await request(
      site(),
      "/api/r/ZZ9999/consultation",
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "afternoon", consent: true, address: ADDRESS }),
    );
    expect(await unknown.json()).toMatchObject({ state: "booked", credits: false, invite: "unknown" });
  });

  it("says an invite held on a waitlist has expired once its area launched over 12 months ago, and grants nothing", async () => {
    const FRIEND_ID = "66666666-6666-4666-8666-666666666666";
    await env.DB.prepare(
      "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2025-08-16T18:30:00.000Z')",
    ).run();
    const code = await codeOf();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2025-07-01T00:00:00.000Z', '+919810000002', 'Karan Bhatia')",
    )
      .bind(FRIEND_ID)
      .run();
    await env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, created_at, updated_at)
       VALUES ('attr-w8', ?1, ?2, '2025-07-01T00:00:00.000Z', 'waitlist', '122018', '2025-07-01T00:00:00.000Z',
         '2025-07-01T00:00:00.000Z')`,
    )
      .bind(code, FRIEND_ID)
      .run();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: false, invite: "expired" });
    const kept = await env.DB.prepare("SELECT grant_state FROM referral_attributions WHERE id = 'attr-w8'").first();
    expect(kept).toEqual({ grant_state: "expired" });
  });

  it("names on the invite the consultation it produced, for ops' record", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
    );
    expect(answer.status).toBe(201);
    const attributed = await env.DB.prepare(
      `SELECT a.type FROM referral_attributions r JOIN appointments a ON a.id = r.consultation_appointment_id
       WHERE r.code = ?1`,
    )
      .bind(code)
      .first();
    expect(attributed).toEqual({ type: "consultation" });
  });

  // The full address before a slot is confirmed, on the site too (ADR 0081).
  it("asks for the address, in the pincode checked, and makes it the friend's", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const body = { ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true };
    const bindings = { CRM_QUEUE: fakeQueue() };

    const without = await request(site(), `/api/r/${code}/consultation`, post(body), bindings);
    expect(without.status).toBe(400);
    expect(await without.json()).toMatchObject({ error: { code: "invalid_request", fields: ["address"] } });

    const elsewhere = { ...body, address: { ...ADDRESS, pincode: "122017" } };
    const mismatched = await request(site(), `/api/r/${code}/consultation`, post(elsewhere), bindings);
    expect(mismatched.status).toBe(400);
    expect(await mismatched.json()).toMatchObject({
      error: { code: "invalid_request", fields: ["address.pincode"] },
    });

    const booked = await request(site(), `/api/r/${code}/consultation`, post({ ...body, address: ADDRESS }), bindings);
    expect(booked.status).toBe(201);
    const friend = await env.DB.prepare("SELECT id FROM people WHERE mobile_e164 = '+919810000002'").first<{
      id: string;
    }>();
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: friend?.id ?? "", deviceLabel: null, now: NOW })}`;
    const profile = await request(client(), "/api/profile", { headers: { Cookie: cookie } });
    expect((await profile.json<{ address: unknown }>()).address).toEqual({
      ...ADDRESS,
      building: null,
      floor: null,
      tower: null,
      landmark: null,
      place_id: null,
    });
  });

  it("refuses an unserved pincode or a day out of range", async () => {
    await pincode("400050", "Bandra", false);
    const code = await codeOf();
    const body = {
      ...FRIEND,
      pincode: "400050",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };
    expect((await request(site(), `/api/r/${code}/consultation`, post(body))).status).toBe(422);
    await pincode("122018", "Gurgaon South City II", true);
    const late = { ...body, pincode: "122018", date: "2026-10-30" };
    expect((await request(site(), `/api/r/${code}/consultation`, post(late))).status).toBe(422);
  });

  it("leaves the lead the CRM syncs, which names no loss extent because the landing does not ask", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const crm = fakeQueue();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(crm.sent).toEqual([{ lead_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    const lead = await env.DB.prepare(
      `SELECT l.source, l.city, l.loss_extent, l.proposed_visit_date FROM leads l JOIN people p ON p.id = l.person_id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(lead).toEqual({
      source: "form",
      city: "Gurgaon",
      loss_extent: null,
      proposed_visit_date: "2026-09-23",
    });
  });

  // With self-serve booking off, ops fix the hour on WhatsApp. The friend is not
  // sent away empty-handed, and ops have the day they asked for.
  it("records a request for ops while self-serve booking is off, holding no slot", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const crm = fakeQueue();
    const answer = await request(
      site({ selfServeBooking: false }),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "requested",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: true,
      invite: "valid",
      one_visit: false,
    });
    // Nothing is held; the lead and the invite still stand.
    expect(crm.sent).toHaveLength(1);
    const held = await env.DB.prepare(
      "SELECT COUNT(*) AS held FROM slot_holds h JOIN people p ON p.id = h.person_id WHERE p.mobile_e164 = '+919810000002'",
    ).first<{ held: number }>();
    expect(held?.held).toBe(0);
    const asked = await env.DB.prepare(
      `SELECT r.pincode, r.requested_date, r.requested_window, r.referral_code
       FROM consultation_requests r JOIN people p ON p.id = r.person_id WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(asked).toEqual({
      pincode: "122018",
      requested_date: "2026-09-23",
      requested_window: "morning",
      referral_code: code,
    });
  });

  // An invited friend may book the consultation and fit in one visit, as the site's own form may (ADR 0105); the
  // first fit to follow, which the form once asked for, is gone with it.
  it("books the consultation and fit in one visit, with the invite's credits, and nothing paid", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({
        ...FRIEND,
        pincode: "122018",
        date: "2026-09-23",
        window: "morning",
        consent: true,
        address: ADDRESS,
        one_visit: true,
        number_code_id: await provedNumberCode("+919810000002"),
      }),
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: true, one_visit: true });
    const held = await env.DB.prepare(
      `SELECT h.type, h.amount, h.one_visit FROM slot_holds h JOIN people p ON p.id = h.person_id
       WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(held).toEqual({ type: "first_fit", amount: 0, one_visit: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM first_fit_requests").first()).toEqual({ n: 0 });
  });
});

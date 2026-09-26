// Referral codes, the landing's APIs, the waitlist and the credit ledger (docs/decisions/0048-referrals.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { newCode } from "../../src/domain/referrals.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/razorpay.ts";
import { appFor, captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW, request } from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

async function pincode(pin: string, area: string, served: boolean) {
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES (?1, ?2, 'Gurgaon', ?3, ?4)",
  )
    .bind(pin, area, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null)
    .run();
}

async function cardConsent(notice: string) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'photos_referral_cards', ?3, 1, ?4)`,
  )
    .bind(crypto.randomUUID(), REFERRER, notice, NOW.toISOString())
    .run();
}

const client = () => appFor("local", fakeDependencies(), {}, "client");
const site = (settings = {}) => appFor("local", fakeDependencies(), settings, "public");

async function codeOf(): Promise<string> {
  const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
  const answer = await request(client(), "/api/refer", { headers: { Cookie: cookie } });
  return (await answer.json<{ code: string }>()).code;
}

const post = (body: object) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
  body: JSON.stringify(body),
});

const FRIEND = { name: "Karan Bhatia", mobile: "98100 00002", turnstile_token: "token" };

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await person(REFERRER, "Rohit Malhotra", "+919810000001");
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
});

describe("referral codes", () => {
  it("are the client's initials and four random characters, with none that look alike", () => {
    const codes = Array.from({ length: 500 }, () => newCode("Rohit Malhotra"));
    expect(codes.every((code) => /^RM[A-HJ-NP-Z2-9]{4}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(450);
    expect(newCode("")).toMatch(/^MM[A-HJ-NP-Z2-9]{4}$/);
    expect(newCode("Ishaan Oberoi")).toMatch(/^XX/);
  });

  it("are made once, and give the invite link, the balance and the fitted friends", async () => {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    const first = await (
      await request(client(), "/api/refer", { headers: { Cookie: cookie } })
    ).json<{
      code: string;
    }>();
    const again = await (await request(client(), "/api/refer", { headers: { Cookie: cookie } })).json();
    expect(again).toEqual({
      code: first.code,
      // Locally the site, where /r/:code is served, is on :4321; mm-api on :8787 has no such page (LIFE-17).
      link: `http://localhost:4321/r/${first.code}`,
      named: false,
      credits: { visits: 0, earliest_expiry: null },
      card: { state: "house", version: 1, consented: false },
      fitted: [],
    });
  });

  // The app's preview (board F4) says what the friend will see, so it names the client exactly when the landing
  // does; and its card sheet asks for the consent (F3) exactly when the current lines have not been agreed to.
  it("say whether the invite names the client, and whether they agreed to the cards' current lines", async () => {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    const read = async (settings = {}) =>
      (
        await request(appFor("local", fakeDependencies(), settings, "client"), "/api/refer", {
          headers: { Cookie: cookie },
        })
      ).json<{ named: boolean; card: { consented: boolean } }>();

    await cardConsent("photos-referral-cards-v1");
    expect(await read()).toMatchObject({ named: false, card: { consented: false } });
    await cardConsent("photos-referral-cards-v2");
    expect(await read()).toMatchObject({ named: true, card: { consented: true } });
    expect(await read({ referrerNameOnInvite: false })).toMatchObject({ named: false, card: { consented: true } });
  });
});

describe("GET /api/r/:code", () => {
  it("names the referrer only with their consent to the invite's current lines", async () => {
    const code = await codeOf();
    const read = async (settings = {}) => (await request(site(settings), `/api/r/${code}`)).json();
    expect(await read()).toEqual({ state: "valid", referrer_first_name: null, card: { state: "house", version: 1 } });
    await cardConsent("photos-referral-cards-v1");
    expect(await read()).toMatchObject({ referrer_first_name: null });
    await cardConsent("photos-referral-cards-v2");
    expect(await read()).toMatchObject({ referrer_first_name: "Rohit" });
    expect(await read({ referrerNameOnInvite: false })).toMatchObject({ referrer_first_name: null });
  });

  it("answers unknown for a code that does not exist, and the house card for an erased referrer", async () => {
    expect(await (await request(site(), "/api/r/ZZ9999")).json()).toMatchObject({ state: "unknown" });
    const code = await codeOf();
    await cardConsent("photos-referral-cards-v2");
    await env.DB.prepare("UPDATE referral_codes SET card_state = 'personal', card_version = 2").run();
    await env.DB.prepare("UPDATE people SET erased_at = ?1").bind(NOW.toISOString()).run();
    expect(await (await request(site(), `/api/r/${code}`)).json()).toEqual({
      state: "valid",
      referrer_first_name: null,
      card: { state: "house", version: 2 },
    });
  });
});

describe("GET /api/pincodes/:pin", () => {
  it("says whether we come there, and refuses what is not an Indian pincode", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    expect(await (await request(site(), "/api/pincodes/122018")).json()).toEqual({
      pincode: "122018",
      served: true,
      area: "Gurgaon South City II",
      city: "Gurgaon",
    });
    expect(await (await request(site(), "/api/pincodes/400050")).json()).toEqual({
      pincode: "400050",
      served: false,
      area: null,
      city: null,
    });
    expect((await request(site(), "/api/pincodes/12345")).status).toBe(400);
    expect((await request(site(), "/api/pincodes/012345")).status).toBe(400);
  });
});

describe("POST /api/r/:code/consultation", () => {
  it("books a free consultation for a new friend, who carries the invite's credits", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const queue = fakeQueue();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: queue },
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "booked",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: true,
      invite: "valid",
    });
    expect(queue.sent).toEqual([{ hold_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    const friend = await env.DB.prepare(
      `SELECT p.name, c.purpose, c.notice_version, r.code, r.via, r.grant_state, h.type, h.amount
       FROM people p JOIN consents c ON c.person_id = p.id JOIN referral_attributions r ON r.referred_person_id = p.id
       JOIN slot_holds h ON h.person_id = p.id WHERE p.mobile_e164 = '+919810000002'`,
    ).first();
    expect(friend).toEqual({
      name: "Karan Bhatia",
      purpose: "whatsapp_visits",
      notice_version: "referral-consultation-v1",
      code,
      via: "consultation",
      grant_state: "pending",
      type: "consultation",
      amount: 0,
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
      }),
      { FSM_QUEUE: fakeQueue() },
    );
    expect(await self.json()).toMatchObject({ credits: false });
    const unknown = await request(
      site(),
      "/api/r/ZZ9999/consultation",
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "afternoon", consent: true }),
      { FSM_QUEUE: fakeQueue() },
    );
    expect(await unknown.json()).toMatchObject({ state: "booked", credits: false, invite: "unknown" });
  });

  // W8 of the audit, 24 September 2026 (BIZ-12, REQ-06).
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
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: false, invite: "expired" });
    const kept = await env.DB.prepare("SELECT grant_state FROM referral_attributions WHERE id = 'attr-w8'").first();
    expect(kept).toEqual({ grant_state: "expired" });
  });

  it("reaches FSM, using the invite's pincode for the city the friend's booking never asks for", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    const hold = await env.DB.prepare(
      "SELECT h.id FROM slot_holds h JOIN people p ON p.id = h.person_id WHERE p.mobile_e164 = '+919810000002'",
    ).first<{ id: string }>();
    const fsm = createStubFsm({
      ...EMPTY_FSM,
      items: [{ id: "item-consult", name: "Consultation", type: "Service", price: null }],
    });
    // The friend has no saved address yet, so the city comes from the invite's pincode.
    expect(await confirmBooking(env.DB, fsm, createStubPayments(), hold?.id ?? "", NOW, { labelAsTest: true })).toBe(
      "booked",
    );
    expect(fsm.made.contacts).toMatchObject([{ city: "Gurgaon", lastName: "Bhatia" }]);
    expect(fsm.made.visits).toHaveLength(1);
    // The attribution names the consultation it produced, for ops' record.
    const attributed = await env.DB.prepare(
      `SELECT a.type FROM referral_attributions r JOIN appointments a ON a.id = r.consultation_appointment_id
       WHERE r.code = ?1`,
    )
      .bind(code)
      .first();
    expect(attributed).toEqual({ type: "consultation" });
  });

  it("refuses an unserved pincode or a day out of range", async () => {
    await pincode("400050", "Bandra", false);
    const code = await codeOf();
    const body = { ...FRIEND, pincode: "400050", date: "2026-09-23", window: "morning", consent: true };
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
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: crm },
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
    const fsm = fakeQueue();
    const crm = fakeQueue();
    const answer = await request(
      site({ selfServeBooking: false }),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true }),
      { FSM_QUEUE: fsm, CRM_QUEUE: crm },
    );

    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({
      state: "requested",
      date: "2026-09-23",
      window: "morning",
      area: "Gurgaon South City II",
      credits: true,
      invite: "valid",
    });
    // Nothing is held and FSM is not told; the lead and the invite still stand.
    expect(fsm.sent).toEqual([]);
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
});

describe("POST /api/r/:code/waitlist", () => {
  it("puts the friend on the list once, with their launch alert, and holds the invite", async () => {
    await pincode("400050", "Bandra", false);
    const code = await codeOf();
    const body = { ...FRIEND, pincode: "400050", contact_consent: true, launch_alert: true };
    const answer = await request(site(), `/api/r/${code}/waitlist`, post(body));
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
    await request(site(), `/api/r/${code}/waitlist`, post({ ...body, launch_alert: false }));
    const entries = await env.DB.prepare("SELECT pincode, referral_code, launch_alert FROM waitlist_entries").all();
    expect(entries.results).toEqual([{ pincode: "400050", referral_code: code, launch_alert: 1 }]);
    const consents = await env.DB.prepare(
      "SELECT purpose, notice_version FROM consents WHERE person_id != ?1 ORDER BY created_at, rowid",
    )
      .bind(REFERRER)
      .all();
    expect(consents.results).toContainEqual({ purpose: "whatsapp_launches", notice_version: "whatsapp-launches-v1" });
    expect(consents.results).toContainEqual({ purpose: "contact", notice_version: "waitlist-v1" });
  });

  it("sends a served pincode to booking instead", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const body = { ...FRIEND, pincode: "122018", contact_consent: true, launch_alert: false };
    expect((await request(site(), "/api/r/ZZ9999/waitlist", post(body))).status).toBe(422);
  });
});

describe("the credit ledger", () => {
  it("grants once per source, spends the soonest to expire first, and forgets expired grants", async () => {
    const db = env.DB;
    await grantCredits(db, { personId: REFERRER, visits: 3, source: "referral", sourceId: "r1", now: NOW }).run();
    await grantCredits(db, { personId: REFERRER, visits: 3, source: "referral", sourceId: "r1", now: NOW }).run();
    const soon = new Date(NOW.getTime() + 10 * DAY);
    await grantCredits(db, {
      personId: REFERRER,
      visits: 2,
      source: "import",
      sourceId: "i1",
      now: NOW,
      expiresAt: soon,
    }).run();
    expect(await creditBalance(db, REFERRER, NOW)).toEqual({ visits: 5, earliestExpiry: soon.toISOString() });

    const redeem = await redeemCredit(db, REFERRER, "visit-1", NOW);
    await redeem?.run();
    const drawn = await db
      .prepare(
        "SELECT g.source_id FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id WHERE r.kind = 'redeem'",
      )
      .first();
    expect(drawn).toEqual({ source_id: "i1" });
    expect((await creditBalance(db, REFERRER, NOW)).visits).toBe(4);
    expect(await creditBalance(db, REFERRER, new Date(soon.getTime() + DAY))).toMatchObject({ visits: 3 });
  });

  it("is append-only", async () => {
    await grantCredits(env.DB, { personId: REFERRER, visits: 3, source: "ops", sourceId: "o1", now: NOW }).run();
    await expect(env.DB.prepare("UPDATE credit_ledger SET visits = 30").run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare("DELETE FROM credit_ledger").run()).rejects.toThrow(/append-only/);
  });

  it("shows on Home once there is a balance", async () => {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    const me = async () =>
      (await (await request(client(), "/api/me", { headers: { Cookie: cookie } })).json<{ credits: unknown }>())
        .credits;
    expect(await me()).toBeNull();
    await grantCredits(env.DB, { personId: REFERRER, visits: 3, source: "ops", sourceId: "o1", now: NOW }).run();
    // To the end of 21 September 2027 in India, a year on (BIZ-14).
    expect(await me()).toEqual({ visits: 3, earliest_expiry: "2027-09-21T18:29:59.999Z" });
  });
});

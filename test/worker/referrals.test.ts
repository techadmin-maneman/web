// Referral codes, the landing's APIs, the waitlist and the credit ledger (docs/decisions/0048-referrals.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits, redeemCredit } from "../../src/domain/credits.ts";
import { newReferralCode } from "../../src/domain/referrals.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
import { createStubPayments } from "../../src/providers/payments.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  provedNumberCode,
  request,
} from "./helpers.ts";

const REFERRER = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)")
    .bind(id, NOW.toISOString(), mobile, name)
    .run();
}

/** A pincode whose area ops have named, unless `named` is false: its name is then still the post offices'. */
async function pincode(pin: string, area: string, served: boolean, named = true) {
  await env.DB.prepare(
    `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at, area_named_by)
     VALUES (?1, ?2, 'Gurgaon', ?3, ?4, ?5)`,
  )
    .bind(pin, area, served ? 1 : 0, served ? "2026-09-01T18:30:00.000Z" : null, named ? "ops@localhost" : null)
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

/** Where the friend's consultation is, typed in full as the landing takes it (ADR 0081). */
const ADDRESS = {
  flat: "Flat 402",
  line1: "Palm Grove Society",
  line2: null,
  locality: "Sector 65",
  city: "Gurgaon",
  pincode: "122018",
  access_notes: null,
};

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
  // PS-54: six random characters, too many to guess.
  it("are the client's initials and six random characters, with none that look alike", () => {
    const codes = Array.from({ length: 500 }, () => newReferralCode("Rohit Malhotra"));
    expect(codes.every((code) => /^RM[A-HJ-NP-Z2-9]{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(495);
    expect(newReferralCode("")).toMatch(/^MM[A-HJ-NP-Z2-9]{6}$/);
    expect(newReferralCode("Ishaan Oberoi")).toMatch(/^XX/);
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
      credits: { visits: 0, earliest_expiry: null, expiring_visits: 0 },
      card: { state: "house", version: 1, consented: false },
      fitted: [],
      invite_credits: null,
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

  // The pay step carries the naming line with the card's (ADR 0080), so a consent given by booking a visit names the
  // referrer as one given on the profile's notice does; and the app's card sheet does not ask for it again (F3).
  it.each(["photos-referral-cards-booking-v1", "photos-referral-cards-booking-alone-v1"])(
    "names a referrer whose consent to cards was given by booking, on %s",
    async (notice) => {
      const code = await codeOf();
      await cardConsent(notice);
      expect(await (await request(site(), `/api/r/${code}`)).json()).toMatchObject({ referrer_first_name: "Rohit" });
      const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
      const refer = await request(client(), "/api/refer", { headers: { Cookie: cookie } });
      expect(await refer.json()).toMatchObject({ named: true, card: { consented: true } });
    },
  );

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

// The owner's ruling of 1 October 2026 (docs/decisions/0107-referral-rewards-in-the-console.md): the site's words
// and the app's read what ops set, never a figure of their own.
describe("what a referral earns, for the pages that say it", () => {
  const unequal = { referrer_visits: 2, friend_visits: 0, valid_days: 90 };
  const setReward = () =>
    env.DB.prepare(
      "INSERT INTO ops_settings (name, value, set_by, set_at) VALUES ('referral_reward', ?1, 'ops@localhost', ?2)",
    )
      .bind(JSON.stringify(unequal), NOW.toISOString())
      .run();

  it("is answered on the site's host as ops set it, the committed figures until they do, kept a minute", async () => {
    const answer = await request(site(), "/api/referral-reward");
    expect(answer.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await answer.json()).toEqual({ referrer_visits: 3, friend_visits: 3, valid_days: 365 });
    await setReward();
    expect(await (await request(site(), "/api/referral-reward")).json()).toEqual(unequal);
    expect((await request(client(), "/api/referral-reward")).status).toBe(404);
  });

  it("reaches the app with the Home card, for a lead's Refer tab as for a fitted client's", async () => {
    await setReward();
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    const me = await (await request(client(), "/api/me", { headers: { Cookie: cookie } })).json();
    expect(me).toMatchObject({ state: "nothing_booked", referral_reward: unequal });
  });
});

// CP-12 of the audit, 2 October 2026: an invited friend was never reminded in the app of the visits the invite
// promised them.
describe("the invite a client came with, on their Home", () => {
  const FRIEND_ID = "77777777-7777-4777-8777-777777777777";

  async function invited(via: "consultation" | "waitlist" = "consultation", pin: string | null = null) {
    const code = await codeOf();
    await person(FRIEND_ID, "Karan Bhatia", "+919810000002");
    await env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, pincode, created_at,
         updated_at)
       VALUES ('attr-home', ?1, ?2, ?3, ?4, ?5, ?3, ?3)`,
    )
      .bind(code, FRIEND_ID, NOW.toISOString(), via, pin)
      .run();
  }

  async function pendingInviteOf(personId: string, settings = {}): Promise<unknown> {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now: NOW })}`;
    const app = appFor("local", fakeDependencies(), settings, "client");
    const me = await (
      await request(app, "/api/me", { headers: { Cookie: cookie } })
    ).json<{ pending_invite: unknown }>();
    return me.pending_invite;
  }

  it("names who sent it exactly where the invite's own page does", async () => {
    await invited();
    expect(await pendingInviteOf(FRIEND_ID)).toEqual({ referrer_first_name: null });
    await cardConsent("photos-referral-cards-v2");
    expect(await pendingInviteOf(FRIEND_ID)).toEqual({ referrer_first_name: "Rohit" });
    expect(await pendingInviteOf(FRIEND_ID, { referrerNameOnInvite: false })).toEqual({ referrer_first_name: null });
    expect(await pendingInviteOf(REFERRER)).toBeNull();
  });

  it("is gone once its visits are settled", async () => {
    await invited();
    await env.DB.prepare("UPDATE referral_attributions SET grant_state = 'granted' WHERE id = 'attr-home'").run();
    expect(await pendingInviteOf(FRIEND_ID)).toBeNull();
  });

  it("is gone once one held on a waitlist has lapsed, 12 months after its area launched", async () => {
    await env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at)
       VALUES ('122018', 'South City II', 'Gurgaon', 1, '2025-08-16T18:30:00.000Z')`,
    ).run();
    await invited("waitlist", "122018");
    expect(await pendingInviteOf(FRIEND_ID)).toBeNull();
  });

  it("is gone once the client is fitted", async () => {
    await invited();
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         fsm_modified_at, synced_at)
       VALUES ('fit-home', 'fsm-fit-home', ?1, 'first_fit', 'completed', 'Completed', ?2, ?2, ?2, ?2)`,
    )
      .bind(FRIEND_ID, new Date(NOW.getTime() - DAY).toISOString())
      .run();
    expect(await pendingInviteOf(FRIEND_ID)).toBeNull();
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

  // BK-27 and CP-25 of the audit, 2 October 2026: "We come to Sec37 Noida", the post office's name for the area.
  it("names no area ops have not named yet, so the page names the city", async () => {
    await pincode("122003", "Sec37", true, false);
    expect(await (await request(site(), "/api/pincodes/122003")).json()).toEqual({
      pincode: "122003",
      served: true,
      area: null,
      city: "Gurgaon",
    });
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
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
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
      one_visit: false,
    });
    expect(queue.sent).toEqual([{ hold_id: expect.any(String) as string, request_id: expect.any(String) as string }]);
    const friend = await env.DB.prepare(
      `SELECT p.name, c.purpose, c.notice_version, c.source, r.code, r.via, r.grant_state, h.type, h.amount
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
      { FSM_QUEUE: fakeQueue() },
    );
    expect(await self.json()).toMatchObject({ credits: false });
    const unknown = await request(
      site(),
      "/api/r/ZZ9999/consultation",
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "afternoon", consent: true, address: ADDRESS }),
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
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
      { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() },
    );
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ state: "booked", credits: false, invite: "expired" });
    const kept = await env.DB.prepare("SELECT grant_state FROM referral_attributions WHERE id = 'attr-w8'").first();
    expect(kept).toEqual({ grant_state: "expired" });
  });

  it("reaches FSM, with the address the friend gave and the city of the pincode they booked at", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const answer = await request(
      site(),
      `/api/r/${code}/consultation`,
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
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
    expect(await confirmBooking(env.DB, fsm, createStubPayments(), hold?.id ?? "", NOW, { labelAsTest: true })).toBe(
      "booked",
    );
    expect(fsm.made.contacts).toMatchObject([
      {
        city: "Gurgaon",
        lastName: "Bhatia",
        street: { street1: "Flat 402, Palm Grove Society", street2: "Sector 65" },
      },
    ]);
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

  // The owner's ruling of 27 September 2026: the full address before a slot is confirmed, on the site too (ADR 0081).
  it("asks for the address, in the pincode checked, and makes it the friend's", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const body = { ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true };
    const bindings = { FSM_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue() };

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
      post({ ...FRIEND, pincode: "122018", date: "2026-09-23", window: "morning", consent: true, address: ADDRESS }),
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
      one_visit: false,
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

  // An invited friend may book the consultation and fit in one visit, as the site's own form may (ADR 0105); the
  // first fit to follow, which the form asked for until the owner's ruling of 1 October 2026, is gone with it.
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
      { FSM_QUEUE: fakeQueue() },
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
      "SELECT purpose, notice_version, source FROM consents WHERE person_id != ?1 ORDER BY created_at, rowid",
    )
      .bind(REFERRER)
      .all();
    expect(consents.results).toContainEqual({
      purpose: "whatsapp_launches",
      notice_version: "whatsapp-launches-v1",
      source: "referral_landing",
    });
    expect(consents.results).toContainEqual({
      purpose: "contact",
      notice_version: "waitlist-v1",
      source: "referral_landing",
    });
  });

  it("sends a served pincode to booking instead", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const body = { ...FRIEND, pincode: "122018", contact_consent: true, launch_alert: false };
    expect((await request(site(), "/api/r/ZZ9999/waitlist", post(body))).status).toBe(422);
  });

  it("records that the landing told the friend who hears of the fit, and that it did not where it could not", async () => {
    await pincode("400050", "Bandra", false);
    const code = await codeOf();
    const told = { ...FRIEND, pincode: "400050", contact_consent: true, launch_alert: false, invite_told: true };
    expect((await request(site(), `/api/r/${code}/waitlist`, post(told))).status).toBe(201);
    const silent = { ...FRIEND, mobile: "98100 00003", pincode: "400050", contact_consent: true, launch_alert: false };
    expect((await request(site(), `/api/r/${code}/waitlist`, post(silent))).status).toBe(201);

    const attributions = await env.DB.prepare(
      `SELECT p.mobile_e164, r.told_notice FROM referral_attributions r JOIN people p ON p.id = r.referred_person_id
       ORDER BY p.mobile_e164`,
    ).all();
    expect(attributions.results).toEqual([
      { mobile_e164: "+919810000002", told_notice: "invite-told-landing-v1" },
      { mobile_e164: "+919810000003", told_notice: null },
    ]);
  });

  // PS-23: anyone can join a list with a number, and once could attribute a client who came on their own, and switch
  // their launch alert back on.
  describe("for a number already in the funnel", () => {
    const KNOWN = "77777777-7777-4777-8777-777777777777";
    const join = (code: string) =>
      request(
        site(),
        `/api/r/${code}/waitlist`,
        post({ ...FRIEND, pincode: "400050", contact_consent: true, launch_alert: true, invite_told: true }),
        { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
      );
    const latestLaunchConsent = () =>
      env.DB.prepare(
        `SELECT granted, source FROM consents WHERE person_id = ?1 AND purpose = 'whatsapp_launches'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
        .bind(KNOWN)
        .first();

    beforeEach(async () => {
      await pincode("400050", "Bandra", false);
      await person(KNOWN, "Karan Bhatia", "+919810000002");
    });

    // The page answers as it would a new number, so it never says the number is known.
    it("carries no invite for someone who has had a consultation, and keeps the launch alert they switched off", async () => {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
           fsm_modified_at, synced_at)
         VALUES ('consulted', 'fsm-consulted', ?1, 'consultation', 'completed', 'Completed',
           '2026-09-10T04:30:00.000Z', '2026-09-10T05:30:00.000Z', ?2, ?2)`,
      )
        .bind(KNOWN, NOW.toISOString())
        .run();
      await env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
         VALUES ('launches-off', ?1, 'whatsapp_launches', 'whatsapp-launches-v1', 0, '2026-09-15T00:00:00.000Z',
           'app_profile')`,
      )
        .bind(KNOWN)
        .run();
      const code = await codeOf();

      const answer = await join(code);
      expect(answer.status).toBe(201);
      expect(await answer.json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM referral_attributions").first())?.n).toBe(0);
      const entry = await env.DB.prepare("SELECT referral_code FROM waitlist_entries WHERE person_id = ?1")
        .bind(KNOWN)
        .first();
      expect(entry).toEqual({ referral_code: null });
      expect(await latestLaunchConsent()).toEqual({ granted: 0, source: "app_profile" });
    });

    it("carries no invite for someone who asked for a consultation on /book without one", async () => {
      await env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
         VALUES ('asked', ?1, '122018', '2026-09-23', 'morning', ?2)`,
      )
        .bind(KNOWN, NOW.toISOString())
        .run();
      const code = await codeOf();

      expect(await (await join(code)).json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM referral_attributions").first())?.n).toBe(0);
    });

    // Decision 7: joining a waitlist says nothing of whether a number is known.
    it("answers the referrer, a fitted client and someone who asked for a visit exactly as a new number", async () => {
      await env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
           fsm_modified_at, synced_at)
         VALUES ('fitted', 'fsm-fitted', ?1, 'first_fit', 'completed', 'Completed',
           '2026-09-10T04:30:00.000Z', '2026-09-10T07:30:00.000Z', ?2, ?2)`,
      )
        .bind(KNOWN, NOW.toISOString())
        .run();
      const code = await codeOf();
      const joinAs = async (mobile: string) =>
        (
          await request(
            site(),
            `/api/r/${code}/waitlist`,
            post({
              ...FRIEND,
              mobile,
              pincode: "400050",
              contact_consent: true,
              launch_alert: false,
              invite_told: true,
            }),
            { CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() },
          )
        ).json();

      const asNew = await joinAs("98100 00009");
      expect(asNew).toEqual({ area: "Bandra", credits: true, invite: "valid" });
      expect(await joinAs("98100 00002")).toEqual(asNew);
      expect(await joinAs("98100 00001")).toEqual(asNew);
    });

    it("says an invite has lapsed to a number we know where it would to a new one", async () => {
      await env.DB.prepare(
        "UPDATE serviceable_pincodes SET launched_at = '2025-08-16T18:30:00.000Z' WHERE pincode = '400050'",
      ).run();
      await env.DB.prepare(
        `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
         VALUES ('asked', ?1, '122018', '2026-09-23', 'morning', ?2)`,
      )
        .bind(KNOWN, NOW.toISOString())
        .run();
      const code = await codeOf();
      expect(await (await join(code)).json()).toEqual({ area: "Bandra", credits: false, invite: "expired" });
    });

    it("still carries the invite, and the launch alert, for someone we know who has asked for nothing", async () => {
      const code = await codeOf();

      expect(await (await join(code)).json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
      const attribution = await env.DB.prepare(
        "SELECT code, via, told_notice FROM referral_attributions WHERE referred_person_id = ?1",
      )
        .bind(KNOWN)
        .first();
      expect(attribution).toEqual({ code, via: "waitlist", told_notice: "invite-told-landing-v1" });
      expect(await latestLaunchConsent()).toEqual({ granted: 1, source: "referral_landing" });
    });
  });
});

// The landing sends one Idempotency-Key per submission (FEO-21): pressing again after the answer was lost on the way
// gets the first answer back, and the friend is booked or listed once.
describe("POST /api/r/:code/*: the Idempotency-Key", () => {
  const keyed = (body: object, key: string) => ({
    ...post(body),
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", "Idempotency-Key": key },
  });
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n;

  it("answers a consultation sent again with its first answer, and books it once", async () => {
    await pincode("122018", "Gurgaon South City II", true);
    const code = await codeOf();
    const body = {
      ...FRIEND,
      pincode: "122018",
      date: "2026-09-23",
      window: "morning",
      consent: true,
      address: ADDRESS,
    };
    const bindings = { FSM_QUEUE: fakeQueue() };

    const first = await request(site(), `/api/r/${code}/consultation`, keyed(body, "key-invite-0001"), bindings);
    const again = await request(site(), `/api/r/${code}/consultation`, keyed(body, "key-invite-0001"), bindings);

    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await count("SELECT COUNT(*) AS n FROM slot_holds")).toBe(1);
  });

  it("answers a waitlist entry sent again with its first answer, and records one lead", async () => {
    await pincode("400050", "Bandra", false);
    const code = await codeOf();
    const body = { ...FRIEND, pincode: "400050", contact_consent: true, launch_alert: true };

    const first = await request(site(), `/api/r/${code}/waitlist`, keyed(body, "key-invite-0002"));
    const again = await request(site(), `/api/r/${code}/waitlist`, keyed(body, "key-invite-0002"));

    expect(first.status).toBe(201);
    expect(await again.json()).toEqual({ area: "Bandra", credits: true, invite: "valid" });
    expect(await count("SELECT COUNT(*) AS n FROM leads")).toBe(1);
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
    expect(await creditBalance(db, REFERRER, NOW)).toEqual({
      visits: 5,
      earliestExpiry: soon.toISOString(),
      expiringFirst: 2,
    });

    await redeemCredit(db, REFERRER, "visit-1", NOW).run();
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
    expect(await me()).toEqual({ visits: 3, earliest_expiry: "2027-09-21T18:29:59.999Z", expiring_visits: 3 });
    // A later grant ends later, so Home can say how many end first.
    await grantCredits(env.DB, {
      personId: REFERRER,
      visits: 2,
      source: "ops",
      sourceId: "o2",
      now: new Date(NOW.getTime() + 86_400_000),
    }).run();
    expect(await me()).toEqual({ visits: 5, earliest_expiry: "2027-09-21T18:29:59.999Z", expiring_visits: 3 });
  });
});

// Referral codes, the landing's APIs, the waitlist and the credit ledger (docs/decisions/0048-referrals.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { captureLogs, fakeQueue, markDatabase, NOW, request } from "../helpers.ts";
import { REFERRER, person, pincode, site, codeOf, post, FRIEND, ADDRESS } from "./referrals-fixtures.ts";

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

  // Anyone can join a list with a number, and once could attribute a client who came on their own, and switch
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
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at)
         VALUES ('consulted', 'consulted', ?1, 'consultation', 'completed', '2026-09-10T04:30:00.000Z',
           '2026-09-10T05:30:00.000Z', ?2)`,
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
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at)
         VALUES ('fitted', 'fitted', ?1, 'first_fit', 'completed', '2026-09-10T04:30:00.000Z',
           '2026-09-10T07:30:00.000Z', ?2)`,
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

// The landing sends one Idempotency-Key per submission: pressing again after the answer was lost on the way
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

    const first = await request(site(), `/api/r/${code}/consultation`, keyed(body, "key-invite-0001"));
    const again = await request(site(), `/api/r/${code}/consultation`, keyed(body, "key-invite-0001"));

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

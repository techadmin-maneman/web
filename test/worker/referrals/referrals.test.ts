// Referral codes, the landing's APIs, the waitlist and the credit ledger (docs/decisions/0048-referrals.md).
// NOW is Monday 21 September 2026, 12 noon in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { creditBalance, grantCredits, redeemCredit } from "../../../src/domain/money/credits.ts";
import { newReferralCode } from "../../../src/domain/referrals/referrals.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  markDatabase,
  NOW,
  request,
  fittedAndPhotographed,
} from "../helpers.ts";
import { REFERRER, person, pincode, client, site, codeOf } from "./referrals-fixtures.ts";

const DAY = 86_400_000;

async function cardConsent(notice: string) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, 'photos_referral_cards', ?3, 1, ?4)`,
  )
    .bind(crypto.randomUUID(), REFERRER, notice, NOW.toISOString())
    .run();
}

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

describe("referral codes", () => {
  // Six random characters, too many to guess.
  it("are the client's initials and six random characters, with none that look alike", () => {
    const codes = Array.from({ length: 500 }, () => newReferralCode("Rohit Malhotra"));
    expect(codes.every((code) => /^RM[A-HJ-NP-Z2-9]{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(495);
    expect(newReferralCode("")).toMatch(/^MM[A-HJ-NP-Z2-9]{6}$/);
    expect(newReferralCode("Ishaan Oberoi")).toMatch(/^XX/);
  });

  // The app showed Refer to the fitted alone, but the API made a code for any client signed in.
  it("are a fitted client's alone: before a first fit, Refer and the card answer not_fitted", async () => {
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    for (const [method, path] of [
      ["GET", "/api/refer"],
      ["GET", "/api/refer/card"],
      ["POST", "/api/refer/card"],
    ] as const) {
      const answer = await request(client(), path, {
        method,
        headers: { Cookie: cookie, Origin: "https://maneman.test" },
      });
      expect(answer.status).toBe(403);
      expect(await answer.json()).toMatchObject({ error: { code: "not_fitted" } });
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM referral_codes").first()).toEqual({ n: 0 });
  });

  it("are made once, and give the invite link, the balance and the fitted friends", async () => {
    await fittedAndPhotographed(REFERRER);
    const cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: REFERRER, deviceLabel: null, now: NOW })}`;
    const first = await (
      await request(client(), "/api/refer", { headers: { Cookie: cookie } })
    ).json<{
      code: string;
    }>();
    const again = await (await request(client(), "/api/refer", { headers: { Cookie: cookie } })).json();
    expect(again).toEqual({
      code: first.code,
      // Locally the site, where /r/:code is served, is on :4321; mm-api on :8787 has no such page.
      link: `http://localhost:4321/r/${first.code}`,
      named: false,
      credits: { visits: 0, earliest_expiry: null, expiring_visits: 0 },
      card: { state: "house", version: 1, consented: false },
      fitted: [],
      invite_credits: null,
    });
  });

  // The app's preview says what the friend will see, so it names the client exactly when the landing
  // does; and its card sheet asks for the consent exactly when the current lines have not been agreed to.
  it("say whether the invite names the client, and whether they agreed to the cards' current lines", async () => {
    await fittedAndPhotographed(REFERRER);
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
  // referrer as one given on the profile's notice does; and the app's card sheet does not ask for it again.
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

// The site's words
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

// An invited friend was never reminded in the app of the visits the invite
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

  // "We come to Sec37 Noida", the post office's name for the area.
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
    // To the end of 21 September 2027 in India, a year on.
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

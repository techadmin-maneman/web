// The referral card, its preview image, the waitlist, a pincode launch and ops' funnel
// (docs/decisions/0048-referrals.md). NOW is Monday 21 September 2026, 12 noon in India. Every name and number
// here is made up, and the photographs and the card are bytes, never images.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CARD } from "../../../src/config/house-card.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { readMeter } from "../../../src/domain/platform/storage-meter.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "../../../src/policy/invites.ts";
import { REFERRERS_PAGE } from "../../../src/routes/ops/waitlist.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  markDatabase,
  NOW,
  request,
  fittedAndPhotographed,
} from "../helpers.ts";
import { jpegOf, recordingCards } from "../cards.ts";
import { PERSON, FRIEND, CODE, ops, consent } from "./referral-cards-fixtures.ts";

let cookie: string;

const client = () => appFor("local", fakeDependencies(), {}, "client");

const site = () => appFor("local", fakeDependencies(), {}, "public");

/** The client asks for their card; the API makes it with `deps`' composer. */
const make = (deps = fakeDependencies()) =>
  request(appFor("local", deps, {}, "client"), "/api/refer/card", {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://maneman.test" },
  });

const card = () =>
  env.DB.prepare("SELECT card_state, card_version, card_key FROM referral_codes WHERE code = ?1")
    .bind(CODE)
    .first<{ card_state: string; card_version: number; card_key: string | null }>();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  // The first fit, with its front photograph after; then the one before it.
  const fit = await fittedAndPhotographed(PERSON);
  const before = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, 'before', ?3)").bind(
      before,
      fit,
      NOW.toISOString(),
    ),
    env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
       VALUES (?1, ?2, 'front', ?3, 'image/jpeg', 1000, ?4, ?4)`,
    ).bind(crypto.randomUUID(), before, `visits/${fit}/before-front.jpg`, NOW.toISOString()),
  ]);
  await env.CLIENT_PHOTOS.put(`visits/${fit}/before-front.jpg`, "the front, before");
  await env.CLIENT_PHOTOS.put(`visits/${fit}/after-front.jpg`, "the front, after");
  await env.DB.prepare("INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
    .bind(CODE, PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("the referral card", () => {
  it("is made from the first fit's front photographs with the client's consent, shown, and taken down", async () => {
    const deps = fakeDependencies({ cards: recordingCards() });
    expect((await make(deps)).status).toBe(409);
    await consent("photos_referral_cards", true);
    const stored = await make(deps);
    expect(await stored.json()).toEqual({ version: 2 });
    expect((deps.cards as ReturnType<typeof recordingCards>).composed).toEqual([
      { before: "the front, before", after: "the front, after" },
    ]);
    expect(await card()).toMatchObject({ card_state: "personal", card_version: 2, card_key: `cards/${CODE}/v2.jpg` });
    // Counted on the storage meter (docs/decisions/0093-the-storage-meter.md).
    expect((await readMeter(env.DB)).bytes).toBe(jpegOf(1200, 630).byteLength);

    const preview = await request(site(), `/api/og/${CODE}.jpg`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("Content-Type")).toBe("image/jpeg");
    expect(preview.headers.get("Content-Length")).toBe("20");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(jpegOf(1200, 630));

    const revoked = await request(client(), "/api/refer/card", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://maneman.test" },
    });
    expect(revoked.status).toBe(204);
    expect(await card()).toMatchObject({ card_state: "house", card_version: 3, card_key: null });
    expect(await env.REFERRAL_CARDS.get(`cards/${CODE}/v2.jpg`)).toBeNull();
    expect((await readMeter(env.DB)).bytes).toBe(0);
    // The house card in its own version, so a chat that cached an older one fetches it afresh.
    const house = await request(site(), `/api/og/${CODE}.jpg?v=3`);
    expect(house.status).toBe(302);
    expect(house.headers.get("Location")).toBe(HOUSE_CARD);
  });

  // A preview reveals a referrer's card, so guessing codes through it spends the address's misses too.
  it("gives the house card for every code to an address past its misses, and the card to anyone else", async () => {
    await consent("photos_referral_cards", true);
    await make();
    const preview = (code: string, address: string) =>
      request(site(), `/api/og/${code}.jpg`, { headers: { "CF-Connecting-IP": address } });

    for (let guess = 0; guess < INVITE_MISSES_PER_ADDRESS_HOURLY; guess += 1) {
      expect((await preview(`ZZ${String(guess).padStart(4, "0")}`, "203.0.113.7")).status).toBe(302);
    }
    const refused = await preview(CODE, "203.0.113.7");
    expect(refused.status).toBe(302);
    expect(refused.headers.get("Location")).toBe(HOUSE_CARD);
    expect((await preview(CODE, "198.51.100.4")).status).toBe(200);
  });

  // Any 1200 x 630 JPEG the client uploaded became their public card; now the API makes it from their photographs.
  it("refuses a card until the first fit's front photographs, before and after, are stored", async () => {
    await consent("photos_referral_cards", true);
    await env.DB.prepare("DELETE FROM photos WHERE r2_key LIKE '%before-front.jpg'").run();
    const refused = await make();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "not_fitted" } });
    expect(await card()).toMatchObject({ card_state: "house", card_version: 1 });
  });

  it("answers unavailable, and keeps no card, when it cannot be made", async () => {
    await consent("photos_referral_cards", true);
    const failing = { compose: () => Promise.reject(new Error("Images said 9422")) };
    expect((await make(fakeDependencies({ cards: failing }))).status).toBe(503);
    expect((await make(fakeDependencies({ cards: recordingCards(jpegOf(1080, 1080)) }))).status).toBe(503);
    expect(await card()).toMatchObject({ card_state: "house", card_version: 1 });
  });

  it("comes down when the consent is switched off, and when the client is erased", async () => {
    await consent("photos_referral_cards", true);
    await make();
    const off = await request(client(), "/api/consents/photos_referral_cards", {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ granted: false }),
    });
    expect(off.status).toBe(200);
    expect(await card()).toMatchObject({ card_state: "house", card_key: null });
    expect((await readMeter(env.DB)).bytes).toBe(0);

    await consent("photos_referral_cards", true);
    await make();
    expect((await card())?.card_state).toBe("personal");
    // A new card replaces the one before it, which is counted no more.
    await make();
    expect((await readMeter(env.DB)).bytes).toBe(jpegOf(1200, 630).byteLength);
    await eraseByMobile("+919810000001", NOW);
    expect(await card()).toMatchObject({ card_state: "house", card_key: null });
    expect((await readMeter(env.DB)).bytes).toBe(0);
  });
});

// The app shows its owner the card the invite shows, and shares it as a photograph: the preview's own route is the
// public host's, and answers nothing on the client app's (test/worker/platform/surfaces.test.ts).
describe("the client's own card, from the client app's host", () => {
  const own = (withCookie = cookie) =>
    request(client(), "/api/refer/card?v=2", withCookie === "" ? {} : { headers: { Cookie: withCookie } });

  it("is the stored card, for its owner alone, kept a day on their phone", async () => {
    await consent("photos_referral_cards", true);
    await make();

    const answer = await own();
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("image/jpeg");
    expect(answer.headers.get("Content-Length")).toBe("20");
    expect(answer.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(jpegOf(1200, 630));

    const signedOut = await own("");
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ error: { code: "session_required" } });
  });

  it("answers 404 with no card of theirs, and once a revoke takes it down", async () => {
    expect((await own()).status).toBe(404);
    await consent("photos_referral_cards", true);
    await make();
    await request(client(), "/api/refer/card", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: "https://maneman.test" },
    });

    const revoked = await own();
    expect(revoked.status).toBe(404);
    expect(await revoked.json()).toMatchObject({ error: { code: "not_found" } });
  });

  // The consent's own row is written here, as the notice's switch leaves one, without the switch taking the card
  // down: the route itself must not answer a card its owner no longer agrees to.
  it("answers 404 once the consent is off, even for a card still stored", async () => {
    await consent("photos_referral_cards", true);
    await make();
    await consent("photos_referral_cards", false);

    expect((await card())?.card_state).toBe("personal");
    expect((await own()).status).toBe(404);
  });

  it("answers nothing once the client is erased: the session ends, and a new one finds no card", async () => {
    await consent("photos_referral_cards", true);
    await make();
    await eraseByMobile("+919810000001", NOW);

    expect((await own()).status).toBe(401);
    const again = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    expect((await own(again)).status).toBe(404);
  });
});

describe("ops' referrers", () => {
  it("counts opens, consultations, fits, grants and the credits spent", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Karan Bhatia')",
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    for (const address of ["203.0.113.7", "198.51.100.4"]) {
      await request(site(), `/api/r/${CODE}`, { headers: { "CF-Connecting-IP": address } });
    }
    await env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
         updated_at)
       VALUES ('a1', ?1, ?2, ?3, 'consultation', 'granted', ?3, ?3)`,
    )
      .bind(CODE, FRIEND, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       VALUES ('g1', ?1, 'grant', 3, 'referral', 'a1', ?2, ?3)`,
    )
      .bind(PERSON, new Date(NOW.getTime() + 86_400_000).toISOString(), NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES ('r1', ?1, 'redeem', -1, 'g1', 'appointment', 'visit-1', ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();

    const answer = await (await request(ops(), "/api/referrers")).json();
    expect(answer).toEqual({
      referrers: [
        {
          code: CODE,
          person_id: PERSON,
          name: "Rohit Malhotra",
          opens: 2,
          consultations: 1,
          fits: 0,
          granted: 1,
          redeemed: 1,
        },
      ],
      more: false,
    });
  });

  // Every referrer was read at once, with a subquery a figure for every row.
  it("answers a page of referrers at a time, the busiest first, and says when there are more", async () => {
    const statements = Array.from({ length: REFERRERS_PAGE }, (_, n) => {
      const id = `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`;
      return [
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          id,
          NOW.toISOString(),
          `+9197000${String(n).padStart(5, "0")}`,
          `Referrer ${String(n).padStart(2, "0")}`,
        ),
        env.DB.prepare(
          "INSERT INTO referral_codes (code, person_id, opens, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        ).bind(`RC${String(n).padStart(4, "0")}`, id, n + 1, NOW.toISOString()),
      ];
    });
    await env.DB.batch(statements.flat());

    type Page = { referrers: { opens: number }[]; more: boolean };
    const first = await (await request(ops(), "/api/referrers")).json<Page>();
    expect(first.referrers).toHaveLength(REFERRERS_PAGE);
    expect(first.referrers[0]?.opens).toBe(REFERRERS_PAGE);
    expect(first.more).toBe(true);

    // Rohit, whose code nobody has opened, is the last.
    const next = await (await request(ops(), `/api/referrers?offset=${String(REFERRERS_PAGE)}`)).json<Page>();
    expect(next).toEqual({ referrers: [expect.objectContaining({ name: "Rohit Malhotra", opens: 0 })], more: false });
  });
});

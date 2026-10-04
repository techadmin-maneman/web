// The referral card, its preview image, the waitlist, a pincode launch and ops' funnel
// (docs/decisions/0048-referrals.md). NOW is Monday 21 September 2026, 12 noon in India. Every name and number
// here is made up, and the card is bytes, never a photograph.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CARD } from "../../src/config/house-card.ts";
import { renderMessage } from "../../src/config/message-templates.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { readMeter } from "../../src/domain/storage-meter.ts";
import { composeLaunchAlert } from "../../src/domain/waitlist.ts";
import { INVITE_MISSES_PER_ADDRESS_HOURLY } from "../../src/policy/invites.ts";
import { REFERRERS_PAGE, WAITLIST_AREAS } from "../../src/routes/ops-waitlist.ts";
import {
  appFor,
  captureLogs,
  eraseByMobile,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  NOW,
  request,
  fittedAndPhotographed,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const CODE = "RM7K2Q";

let cookie: string;
const client = () => appFor("local", fakeDependencies(), {}, "client");
const site = () => appFor("local", fakeDependencies(), {}, "public");
const ops = () => appFor("local", fakeDependencies(), {}, "ops");

/** A JPEG's bytes as far as its frame header: enough to read its size, and nothing of anyone. */
function jpegOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(20);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  view.setUint16(4, 11); // the frame header's length
  bytes[6] = 8; // bits a sample
  view.setUint16(7, height);
  view.setUint16(9, width);
  bytes.set([0xff, 0xd9], 17);
  return bytes;
}

async function consent(purpose: string, granted: boolean, personId = PERSON) {
  await env.DB.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
     VALUES (?1, ?2, ?3, 'photos-referral-cards-v2', ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), personId, purpose, granted ? 1 : 0, new Date(Date.now()).toISOString())
    .run();
}

const put = (body: Uint8Array) =>
  request(client(), "/api/refer/card", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "image/jpeg", Origin: "https://maneman.test" },
    body,
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
  await fittedAndPhotographed(PERSON);
  await env.DB.prepare("INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)")
    .bind(CODE, PERSON, NOW.toISOString())
    .run();
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
});

describe("the referral card", () => {
  it("is stored with the client's consent, shown as the invite's preview, and taken down on a revoke", async () => {
    expect((await put(jpegOf(1200, 630))).status).toBe(409);
    await consent("photos_referral_cards", true);
    const stored = await put(jpegOf(1200, 630));
    expect(await stored.json()).toEqual({ version: 2 });
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

  // PS-54: a preview reveals a referrer's card, so guessing codes through it spends the address's misses too.
  it("gives the house card for every code to an address past its misses, and the card to anyone else", async () => {
    await consent("photos_referral_cards", true);
    await put(jpegOf(1200, 630));
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

  // PS-63: any 1200 x 630 JPEG became a client's public card; a card is made from their first fit's photographs.
  it("refuses a card until a photograph of the client's first fit is stored", async () => {
    await consent("photos_referral_cards", true);
    await env.DB.prepare("DELETE FROM photos").run();
    const refused = await put(jpegOf(1200, 630));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "not_fitted" } });
    expect(await card()).toMatchObject({ card_state: "house", card_version: 1 });
  });

  it("refuses anything that is not a 1200 by 630 JPEG", async () => {
    await consent("photos_referral_cards", true);
    expect((await put(jpegOf(1080, 1080))).status).toBe(422);
    expect((await put(new Uint8Array([1, 2, 3]))).status).toBe(422);
    expect(await card()).toMatchObject({ card_state: "house", card_version: 1 });
  });

  it("comes down when the consent is switched off, and when the client is erased", async () => {
    await consent("photos_referral_cards", true);
    await put(jpegOf(1200, 630));
    const off = await request(client(), "/api/consents/photos_referral_cards", {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ granted: false }),
    });
    expect(off.status).toBe(200);
    expect(await card()).toMatchObject({ card_state: "house", card_key: null });
    expect((await readMeter(env.DB)).bytes).toBe(0);

    await consent("photos_referral_cards", true);
    await put(jpegOf(1200, 630));
    expect((await card())?.card_state).toBe("personal");
    // A new card replaces the one before it, which is counted no more.
    await put(jpegOf(1200, 630));
    expect((await readMeter(env.DB)).bytes).toBe(jpegOf(1200, 630).byteLength);
    await eraseByMobile("+919810000001", NOW);
    expect(await card()).toMatchObject({ card_state: "house", card_key: null });
    expect((await readMeter(env.DB)).bytes).toBe(0);
  });
});

// The app shows its owner the card the invite shows, and shares it as a photograph: the preview's own route is the
// public host's, and answers nothing on the client app's (test/worker/surfaces.test.ts).
describe("the client's own card, from the client app's host", () => {
  const own = (withCookie = cookie) =>
    request(client(), "/api/refer/card?v=2", withCookie === "" ? {} : { headers: { Cookie: withCookie } });

  it("is the stored card, for its owner alone, kept a day on their phone", async () => {
    await consent("photos_referral_cards", true);
    await put(jpegOf(1200, 630));

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
    await put(jpegOf(1200, 630));
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
    await put(jpegOf(1200, 630));
    await consent("photos_referral_cards", false);

    expect((await card())?.card_state).toBe("personal");
    expect((await own()).status).toBe(404);
  });

  it("answers nothing once the client is erased: the session ends, and a new one finds no card", async () => {
    await consent("photos_referral_cards", true);
    await put(jpegOf(1200, 630));
    await eraseByMobile("+919810000001", NOW);

    expect((await own()).status).toBe(401);
    const again = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW })}`;
    expect((await own(again)).status).toBe(404);
  });
});

describe("the waitlist and a launch", () => {
  /** Someone waiting in Bandra, whose area ops have named unless `named` is false. */
  async function waiting(alert: boolean, named = true) {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Karan Bhatia')",
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO serviceable_pincodes (pincode, area, city, served, area_named_by)
       VALUES ('400050', 'Bandra', 'Mumbai', 0, ?1)`,
    )
      .bind(named ? "ops@localhost" : null)
      .run();
    await env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, referral_code, contact_consent_at, launch_alert, created_at)
       VALUES ('w1', '400050', ?1, ?2, ?3, ?4, ?3)`,
    )
      .bind(FRIEND, CODE, NOW.toISOString(), alert ? 1 : 0)
      .run();
    if (alert) await consent("whatsapp_launches", true, FRIEND);
  }

  const launch = (body: object, queue = fakeQueue()) =>
    request(
      ops(),
      "/api/pincodes/400050/launch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify(body),
      },
      { MESSAGE_QUEUE: queue },
    );

  it("lists who is waiting, says what a launch would send, then launches and tells them once", async () => {
    await waiting(true);
    const list = await (await request(ops(), "/api/waitlist")).json();
    expect(list).toEqual({
      areas: [
        {
          pincode: "400050",
          area: "Bandra",
          city: "Mumbai",
          served: false,
          launched_at: null,
          waiting: 1,
          oldest: NOW.toISOString(),
          referred: 1,
          alerts: 1,
        },
      ],
      more: false,
      cities: ["Gurgaon", "Delhi", "Noida", "Faridabad", "Ghaziabad", "Mumbai", "Bengaluru"],
    });
    expect(await (await launch({ confirm: false })).json()).toEqual({
      pincode: "400050",
      waiting: 1,
      alerts: 1,
      launched: false,
    });

    const queue = fakeQueue();
    expect(await (await launch({ confirm: true, launch_on: "2026-09-15" }, queue)).json()).toMatchObject({
      alerts: 1,
      launched: true,
    });
    expect(queue.sent).toHaveLength(1);
    const pincode = await env.DB.prepare("SELECT served, launched_at FROM serviceable_pincodes").first();
    expect(pincode).toEqual({ served: 1, launched_at: "2026-09-14T18:30:00.000Z" });
    const message = await env.DB.prepare("SELECT person_id, kind, subject_id FROM outbound_messages").first();
    expect(message).toEqual({ person_id: FRIEND, kind: "launch_alert", subject_id: "400050" });
    const composed = await composeLaunchAlert(env.DB, "400050", FRIEND, "local");
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hi Karan, Mane Man now comes to Bandra. Book your free consultation: http://localhost:4321/book",
    );

    // Launched again: nobody is told twice.
    const second = fakeQueue();
    expect(await (await launch({ confirm: true }, second)).json()).toMatchObject({ alerts: 0 });
    expect(second.sent).toEqual([]);
  });

  // BK-27 and CP-25 of the audit, 2 October 2026: a launch named the area by its post office's name.
  it("names the city in the launch alert, and to ops, until ops name the area", async () => {
    await waiting(true, false);
    expect(await (await request(ops(), "/api/waitlist")).json()).toMatchObject({
      areas: [{ pincode: "400050", area: null, city: "Mumbai" }],
    });
    expect((await launch({ confirm: true })).status).toBe(200);
    const composed = await composeLaunchAlert(env.DB, "400050", FRIEND, "local");
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hi Karan, Mane Man now comes to Mumbai. Book your free consultation: http://localhost:4321/book",
    );
  });

  // The waitlist was read whole, however many pincodes people were waiting in (FEO-16).
  it("lists the longest-waiting pincodes, a page at most, and says when there are more", async () => {
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Karan Bhatia')",
    )
      .bind(FRIEND, NOW.toISOString())
      .run();
    await env.DB.batch(
      Array.from({ length: WAITLIST_AREAS + 1 }, (_, n) =>
        env.DB.prepare(
          `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
           VALUES (?1, ?2, ?3, ?4, ?4)`,
        ).bind(
          `w${String(n)}`,
          String(400001 + n),
          FRIEND,
          new Date(NOW.getTime() - (WAITLIST_AREAS + 1 - n) * 60_000).toISOString(),
        ),
      ),
    );

    const list = await (await request(ops(), "/api/waitlist")).json<{ areas: { pincode: string }[]; more: boolean }>();
    expect(list.areas).toHaveLength(WAITLIST_AREAS);
    expect(list.areas[0]?.pincode).toBe("400001");
    expect(list.more).toBe(true);
  });

  /** `count` more people waiting in Bandra, each asking for the launch alert. */
  async function manyWaiting(count: number) {
    const at = NOW.toISOString();
    const statements = Array.from({ length: count }, (_, n) => {
      const personId = crypto.randomUUID();
      return [
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, 'Waiting')").bind(
          personId,
          at,
          `+9198200${String(n).padStart(5, "0")}`,
        ),
        env.DB.prepare(
          `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, launch_alert, created_at)
           VALUES (?1, '400050', ?2, ?3, 1, ?3)`,
        ).bind(crypto.randomUUID(), personId, at),
        env.DB.prepare(
          `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
           VALUES (?1, ?2, 'whatsapp_launches', 'launches-v1', 1, ?3)`,
        ).bind(crypto.randomUUID(), personId, at),
      ];
    });
    await env.DB.batch(statements.flat());
  }

  // BCL-06 and PLAT-24 of the audit, 2 October 2026: over a hundred alerts went to the queue in one batch, which it
  // refuses, and the launch answered 500 although it had been made.
  it("queues a long waitlist's alerts in batches the queue takes, a hundred at most", async () => {
    await waiting(true);
    await manyWaiting(200);
    const batchSizes: number[] = [];
    const queue = fakeQueue();
    const takeBatch = queue.sendBatch.bind(queue);
    queue.sendBatch = (messages, options) => {
      const batch = [...messages];
      batchSizes.push(batch.length);
      if (batch.length > 100) return Promise.reject(new Error("Too many messages in the batch"));
      return takeBatch(batch, options);
    };

    const answer = await launch({ confirm: true }, queue);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ alerts: 201, launched: true });
    expect(batchSizes).toEqual([100, 100, 1]);
    expect(queue.sent).toHaveLength(201);
  });

  it("launches, and says so, when the queue refuses the alerts, which the sweeper then sends", async () => {
    await waiting(true);
    const down = { ...fakeQueue(), sendBatch: () => Promise.reject(new Error("queue unavailable")) };

    const answer = await launch({ confirm: true }, down);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ alerts: 1, launched: true });
    const alert = await env.DB.prepare("SELECT state FROM outbound_messages WHERE kind = 'launch_alert'").first();
    expect(alert).toEqual({ state: "queued" });
  });

  // BK-38 of the audit, 2 October 2026: a launch dated to a later day served the pincode at once, so its alerts went
  // out and /book took bookings before the day.
  it("refuses a launch dated to a day still to come, and sends nothing", async () => {
    await waiting(true);
    const queue = fakeQueue();
    const answer = await launch({ confirm: true, launch_on: "2026-09-22" }, queue);
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: { code: "launch_in_future", fields: ["launch_on"] } });
    expect(queue.sent).toEqual([]);
    const pincode = await env.DB.prepare("SELECT served, launched_at FROM serviceable_pincodes").first();
    expect(pincode).toEqual({ served: 0, launched_at: null });
  });

  // BK-38: the waitlist kept an earlier launch date where Settings overwrote it. Both launch through one function: a
  // pincode that begins serving is dated from the launch day, and one already live keeps its date.
  it("dates a pincode it begins serving from the launch day, and keeps the date of one already live", async () => {
    await waiting(true);
    await env.DB.prepare(
      "UPDATE serviceable_pincodes SET launched_at = '2026-01-04T18:30:00.000Z' WHERE pincode = '400050'",
    ).run();
    expect((await launch({ confirm: true })).status).toBe(200);
    const launched = await env.DB.prepare("SELECT launched_at FROM serviceable_pincodes").first();
    expect(launched).toEqual({ launched_at: "2026-09-20T18:30:00.000Z" });

    expect((await launch({ confirm: true, launch_on: "2026-09-01" })).status).toBe(200);
    const kept = await env.DB.prepare("SELECT launched_at FROM serviceable_pincodes").first();
    expect(kept).toEqual({ launched_at: "2026-09-20T18:30:00.000Z" });
  });

  // BK-36 and OIA-13 of the audit, 2 October 2026: every pincode on staging's waitlist was outside the service area,
  // so "Mark live" answered "We have no such pincode", and no screen could add one.
  it("adds a pincode people wait in that the service area does not hold, then launches it and tells them", async () => {
    await waiting(true);
    await env.DB.prepare("DELETE FROM serviceable_pincodes WHERE pincode = '400050'").run();
    expect(await (await request(ops(), "/api/waitlist")).json()).toMatchObject({
      areas: [{ pincode: "400050", area: null, city: null, served: false }],
    });
    expect((await launch({ confirm: false })).status).toBe(404);

    const added = await request(ops(), "/api/pincodes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ pincode: "400050", area: "Bandra West", city: "Mumbai" }),
    });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({ pincode: "400050", served: false, waiting: 1, to_alert: 1 });

    const queue = fakeQueue();
    expect(await (await launch({ confirm: true }, queue)).json()).toMatchObject({ alerts: 1, launched: true });
    const composed = await composeLaunchAlert(env.DB, "400050", FRIEND, "local");
    expect("skip" in composed ? composed : renderMessage(composed.template, composed.params)).toBe(
      "Hi Karan, Mane Man now comes to Bandra West. Book your free consultation: http://localhost:4321/book",
    );
  });

  it("tells nobody who did not ask, and refuses a pincode we do not know", async () => {
    await waiting(false);
    const queue = fakeQueue();
    expect(await (await launch({ confirm: true }, queue)).json()).toMatchObject({ alerts: 0, launched: true });
    expect(queue.sent).toEqual([]);
    const unknown = await request(ops(), "/api/pincodes/560001/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify({ confirm: false }),
    });
    expect(unknown.status).toBe(404);
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

  // Every referrer was read at once, with a subquery a figure for every row (FEO-16).
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

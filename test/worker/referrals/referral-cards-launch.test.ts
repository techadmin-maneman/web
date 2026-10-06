// The referral card, its preview image, the waitlist, a pincode launch and ops' funnel
// (docs/decisions/0048-referrals.md). NOW is Monday 21 September 2026, 12 noon in India. Every name and number
// here is made up, and the photographs and the card are bytes, never images.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { renderMessage } from "../../../src/config/message-templates.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { composeLaunchAlert } from "../../../src/domain/booking/waitlist.ts";
import { WAITLIST_AREAS } from "../../../src/routes/ops/waitlist.ts";
import { captureLogs, fakeQueue, markDatabase, NOW, request, fittedAndPhotographed } from "../helpers.ts";
import { PERSON, FRIEND, CODE, ops, consent } from "./referral-cards-fixtures.ts";

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
  await openSession(env.DB, { kind: "client", subjectId: PERSON, deviceLabel: null, now: NOW });
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

  // A launch named the area by its post office's name.
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

  // The waitlist was read whole, however many pincodes people were waiting in.
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

  // Over a hundred alerts once went to the queue in one batch, which it
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

  // A launch dated to a later day served the pincode at once, so its alerts went
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

  // The waitlist kept an earlier launch date where Settings overwrote it. Both launch through one function: a
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

  // Every pincode on staging's waitlist was outside the service area,
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

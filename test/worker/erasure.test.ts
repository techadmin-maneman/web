import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { alertAgedDeletions, deletionsWaiting } from "../../src/domain/deletion.ts";
import { erasePerson } from "../../src/domain/erasure.ts";
import { sendUnsentLinks } from "../../src/domain/payment-links.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { putCounted, readMeter } from "../../src/domain/storage-meter.ts";
import type { Providers } from "../../src/config/environments.ts";
import type { Dependencies } from "../../src/dependencies.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { secretsMatch } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import type { PlacesReached } from "../../src/policy/access.ts";
import { STUB_IDENTITY } from "../../src/providers/cloudflare-access.ts";
import { createStubFsm } from "../../src/providers/fsm.ts";
import { createStubPayments, type StubPayments } from "../../src/providers/payments.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  LOCAL_CONFIG,
  NOW,
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  phaseOneLead,
  request,
} from "./helpers.ts";
import { insertJob, syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const MOBILE_E164 = "+919810000001";
const STAFF = STUB_IDENTITY.kind === "staff" ? STUB_IDENTITY.email : "";
const EVERYWHERE: PlacesReached = { kind: "everywhere" };

/** A person with a booking, as Phase 1's form left one, and an e-mail address. */
async function book(): Promise<string> {
  await phaseOneLead(MOBILE_E164);
  // The booking form takes no e-mail; set one to show that it is blanked too.
  const person = await env.DB.prepare(
    "UPDATE people SET email = 'arjun@example.com' WHERE mobile_e164 = ? RETURNING id",
  )
    .bind(MOBILE_E164)
    .first<{ id: string }>();
  return person?.id ?? "";
}

/** A person with a booking, three try-ons in different states, messages, a session and a try-on consent. */
async function personWithHistory(): Promise<string> {
  const personId = await book();
  await insertJob({ id: "ready", person_id: personId, state: "ready", result_key: "results/ready.png" });
  await insertJob({ id: "running", person_id: personId, state: "rendering" });
  await insertJob({ id: "failed", person_id: personId, state: "failed", upload_deleted_at: NOW.toISOString() });
  await env.UPLOADS.put("uploads/ready", syntheticJpeg(800, 800));
  await env.UPLOADS.put("uploads/running", syntheticJpeg(800, 800));
  await env.RESULTS.put("results/ready.png", syntheticPng(512, 512));

  const at = NOW.toISOString();
  await env.DB.batch([
    ...["waiting", "queued", "sent"].map((state) =>
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
         VALUES (?, ?, ?, 'tryon_result', 'ready', ?)`,
      ).bind(`message-${state}`, at, personId, state),
    ),
    env.DB.prepare("INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('s', ?, ?, ?)").bind(
      personId,
      at,
      at,
    ),
    env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('c-tryon', ?, 'result_delivery', 'gate-v1', 1, ?)`,
    ).bind(personId, at),
  ]);
  return personId;
}

interface Erasing {
  readonly body?: Record<string, unknown>;
  readonly queues?: Partial<Env>;
  readonly deps?: Dependencies;
  readonly surface?: "ops" | "public";
  readonly providers?: Partial<Providers>;
}

/** Ops erasing the client from their page in the console. */
function erase(personId: string, erasing: Erasing = {}) {
  return request(
    appFor("local", erasing.deps ?? fakeDependencies(), {}, erasing.surface ?? "ops", erasing.providers),
    `/api/clients/${personId}/erasure`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(erasing.body ?? {}),
    },
    erasing.queues ?? { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() },
  );
}

const statusOf = async (personId: string, erasing: Erasing = {}) => (await erase(personId, erasing)).status;

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("POST /api/clients/:id/erasure", () => {
  it("deletes the photos and results, blanks the person, cancels unsent messages and queues the CRM and FSM", async () => {
    const personId = await personWithHistory();
    const queues = { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() };

    const response = await erase(personId, { queues });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      erased_at: NOW.toISOString(),
      photos_deleted: 2,
      results_deleted: 1,
      visit_photos_deleted: 0,
      messages_cancelled: 2,
      sessions_ended: 0,
      addresses_removed: 0,
    });
    const queued = [{ erase_person_id: personId, request_id: expect.any(String) as string }];
    expect(queues.CRM_QUEUE.sent).toEqual(queued);
    expect(queues.FSM_QUEUE.sent).toEqual(queued);

    expect(await env.UPLOADS.head("uploads/ready")).toBeNull();
    expect(await env.UPLOADS.head("uploads/running")).toBeNull();
    expect(await env.RESULTS.head("results/ready.png")).toBeNull();

    expect(await env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(personId).first()).toMatchObject({
      name: "Erased",
      email: null,
      mobile_e164: `erased:${personId}`,
      contactable: 0,
      erased_at: NOW.toISOString(),
    });
    const jobs = await env.DB.prepare(
      "SELECT id, state, result_key, upload_deleted_at FROM tryon_jobs WHERE person_id = ? ORDER BY id",
    )
      .bind(personId)
      .all();
    expect(jobs.results).toEqual([
      { id: "failed", state: "failed", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "ready", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
      { id: "running", state: "expired", result_key: null, upload_deleted_at: NOW.toISOString() },
    ]);

    const messages = await env.DB.prepare("SELECT id, state FROM outbound_messages ORDER BY id").all();
    expect(messages.results).toEqual([
      { id: "message-queued", state: "skipped" },
      { id: "message-sent", state: "sent" },
      { id: "message-waiting", state: "skipped" },
    ]);
    const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_sessions WHERE person_id = ?")
      .bind(personId)
      .first<{ n: number }>();
    expect(sessions?.n).toBe(0);

    const withdrawals = await env.DB.prepare(
      "SELECT purpose, source FROM consents WHERE person_id = ? AND notice_version = 'withdrawal' AND granted = 0 ORDER BY purpose",
    )
      .bind(personId)
      .all();
    expect(withdrawals.results).toEqual([
      { purpose: "contact", source: "erasure" },
      { purpose: "result_delivery", source: "erasure" },
    ]);
    const event = await env.DB.prepare(
      "SELECT payload_json FROM events WHERE name = 'person_erased' AND subject_id = ?",
    )
      .bind(personId)
      .first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({ photos: 2, results: 1 });
  });

  it("never writes the person's name, number or e-mail to the logs", async () => {
    const personId = await personWithHistory();
    await erase(personId);
    const written = JSON.stringify(logs.lines());
    expect(written).toContain("person_erased");
    for (const secret of ["Arjun", "9810000001", "arjun@example.com"]) expect(written).not.toContain(secret);
  });

  // PS-16: the operators' door took one shared secret and left nothing in the audit log.
  it("audits the erasure under the member of staff who did it", async () => {
    const personId = await book();

    expect(await statusOf(personId)).toBe(200);

    const entries = await env.DB.prepare(
      "SELECT actor_kind, actor, subject_kind, subject_id, detail FROM audit_log WHERE action = 'person.erase'",
    ).all();
    expect(entries.results).toEqual([
      {
        actor_kind: "staff",
        actor: STAFF,
        subject_kind: "person",
        subject_id: personId,
        detail: JSON.stringify({ settled_by_hand: false, visits: 0, bookings: 0, payments: 0, links: 0 }),
      },
    ]);
  });

  it("refuses a service token, which names no member of staff, and erases nothing", async () => {
    const personId = await book();
    const deps = fakeDependencies({
      access: { verify: () => Promise.resolve({ ok: true, identity: { kind: "service", clientId: "ci.access" } }) },
    });

    expect(await statusOf(personId, { deps })).toBe(403);

    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first();
    expect(person).toEqual({ erased_at: null });
  });

  it("is not on the public host, where a shared secret once opened it", async () => {
    const personId = await book();
    const byNumber = await request(appFor(), "/api/erasure", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer a-secret-of-at-least-thirty-two-chars" },
      body: JSON.stringify({ mobile: "98100 00001" }),
    });

    expect(byNumber.status).toBe(404);
    expect(await statusOf(personId, { surface: "public" })).toBe(404);
    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first();
    expect(person).toEqual({ erased_at: null });
  });

  it("answers 404 for someone it does not know, and for someone already erased", async () => {
    expect(await statusOf(crypto.randomUUID())).toBe(404);
    const personId = await book();
    expect(await statusOf(personId)).toBe(200);
    expect(await statusOf(personId)).toBe(404);
  });

  it("lets the number book again afterwards, as a new person needing a new consent", async () => {
    const erased = await book();
    await erase(erased);
    const again = await book();
    expect(again).not.toBe(erased);
    const consents = await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE person_id = ?")
      .bind(again)
      .first<{ n: number }>();
    expect(consents?.n).toBe(1);
  });

  it("refuses a body with anything but whether to erase despite what is owed", async () => {
    const personId = await book();
    expect(await statusOf(personId, { body: { mobile: "98100 00001" } })).toBe(400);
  });

  it("still erases when the queues are down, leaving the CRM and FSM to the sweeper", async () => {
    const personId = await book();
    const down = { send: () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue;

    expect(await statusOf(personId, { queues: { CRM_QUEUE: down, FSM_QUEUE: down } })).toBe(200);

    expect(logs.lines().some((line) => line.event === "erasure_enqueue_failed")).toBe(true);
  });

  it("leaves FSM alone where it is not connected", async () => {
    const personId = await book();
    const queues = { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() };

    expect(await statusOf(personId, { queues, providers: { FSM_PROVIDER: "none" } })).toBe(200);

    expect(queues.CRM_QUEUE.sent).toHaveLength(1);
    expect(queues.FSM_QUEUE.sent).toEqual([]);
  });
});

/** A deletion request the client made in their app, six days ago, still waiting for ops. */
async function openRequest(personId: string): Promise<void> {
  const sixDaysAgo = new Date(NOW.getTime() - 6 * 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('request-1', ?1, ?2, 'requested')",
  )
    .bind(personId, sixDaysAgo)
    .run();
}

const alertsNow = () => alertAgedDeletions(env.DB, NOW, fakeDependencies().alertOnce);

// PS-17: the operators' door left the client's own request listed as waiting, and alerting.
describe("a client erased with a deletion request open", () => {
  it("has the request closed by the erasure, under whoever erased them", async () => {
    const personId = await book();
    await openRequest(personId);

    expect(await statusOf(personId)).toBe(200);

    const closed = await env.DB.prepare("SELECT state, decided_at, decided_by FROM deletion_requests").first();
    expect(closed).toEqual({ state: "done", decided_at: NOW.toISOString(), decided_by: STAFF });
    expect(await deletionsWaiting(env.DB, EVERYWHERE)).toEqual([]);
    expect(await alertsNow()).toBe(0);
  });

  it("closes the request's alert on Tasks with it", async () => {
    const personId = await book();
    await openRequest(personId);
    expect(await alertsNow()).toBe(1);

    expect(await statusOf(personId)).toBe(200);

    const open = await env.DB.prepare(
      "SELECT key FROM alerts WHERE resolved_at IS NULL AND key LIKE 'deletion_waiting:%'",
    ).all();
    expect(open.results).toEqual([]);
  });

  it("is left out of the queue and its alert when an earlier erasure left the request open", async () => {
    const personId = await book();
    await openRequest(personId);
    await erasePerson(env, personId, NOW, createLogger());

    expect(await deletionsWaiting(env.DB, EVERYWHERE)).toEqual([]);
    expect(await alertsNow()).toBe(0);
  });
});

describe("erasePerson", () => {
  it("deletes a result a running render stored after the jobs were read", async () => {
    const personId = await book();
    await insertJob({ id: "late", person_id: personId, state: "downloading" });
    await env.RESULTS.put("results/late.jpg", syntheticJpeg(512, 512));

    const summary = await erasePerson(env, personId, NOW, createLogger());

    expect(summary?.resultsDeleted).toBe(0); // it had no result_key when read
    expect(await env.RESULTS.head("results/late.jpg")).toBeNull();
  });
});

const VISIT = "visit-1";
const VISIT_PHOTO = `visits/${VISIT}/after-front-1.jpg`;
const CARD = "cards/ARJUN1/v2.jpg";

/**
 * A client with something in every table erasure deletes from, and a row in
 * each table that points at one of those: a check-in measured against their
 * address, and the two codes of a number change still under way.
 */
async function clientWithEverything(): Promise<string> {
  const personId = await personWithHistory();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, technician_id,
         fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-01T06:30:00.000Z', 't1', ?3, ?3)`,
    ).bind(VISIT, personId, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, access_notes, flat)
       VALUES ('address-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.39, 77.06, 'Gate code 4417', '7B')`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, replaced_at)
       VALUES ('address-0', ?1, ?2, 'Old house', 'Sector 56', 'Gurgaon', '122011', ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, distance_m, radius_m, passed,
         created_at)
       VALUES ('checkin-1', ?1, 't1', 'address-1', ?2, 28.39, 77.06, 12, 200, 1, ?2)`,
    ).bind(VISIT, at),
    env.DB.prepare(
      "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-1', ?1, 'after', ?2)",
    ).bind(VISIT, at),
    env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES ('photo-1', 'set-1', 'front', ?1, 'image/jpeg', 3, 600, 800, ?2, ?2)`,
    ).bind(VISIT_PHOTO, at),
    env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, state)
       VALUES ('change-1', ?1, ?2, '+919810000009', 'verifying')`,
    ).bind(personId, at),
    ...["number_change_old", "number_change_new"].map((purpose) =>
      env.DB.prepare(
        `INSERT INTO otp_challenges (id, created_at, person_id, purpose, channel, code_hash, last_sent_at, expires_at,
           number_change_id)
         VALUES (?1, ?2, ?3, ?4, 'whatsapp', 'a-hash', ?2, ?2, 'change-1')`,
      ).bind(`code-${purpose}`, at, personId, purpose),
    ),
    env.DB.prepare(
      `INSERT INTO referral_codes (code, person_id, card_state, card_version, card_key, created_at, updated_at)
       VALUES ('ARJUN1', ?1, 'personal', 2, ?2, ?3, ?3)`,
    ).bind(personId, CARD, at),
    env.DB.prepare(
      `INSERT INTO waitlist_entries (id, pincode, person_id, contact_consent_at, created_at)
       VALUES ('wait-1', '400050', ?1, ?2, ?2)`,
    ).bind(personId, at),
    env.DB.prepare(
      "INSERT INTO grievances (id, person_id, text, state, created_at) VALUES ('g-1', ?1, 'Please call first.', 'open', ?2)",
    ).bind(personId, at),
  ]);
  await env.CLIENT_PHOTOS.put(VISIT_PHOTO, syntheticJpeg(600, 800));
  await env.REFERRAL_CARDS.put(CARD, syntheticJpeg(1200, 630));
  return personId;
}

/** Whether each file the client left is still in its bucket. */
async function filesLeft() {
  return {
    upload: (await env.UPLOADS.head("uploads/ready")) !== null,
    result: (await env.RESULTS.head("results/ready.png")) !== null,
    visitPhoto: (await env.CLIENT_PHOTOS.head(VISIT_PHOTO)) !== null,
    card: (await env.REFERRAL_CARDS.head(CARD)) !== null,
  };
}

/** Makes D1 refuse the erasure's batch, as any failure part-way through it would. */
async function databaseRefusesErasure(): Promise<void> {
  await env.DB.prepare(
    `CREATE TRIGGER refuse_erasure BEFORE UPDATE OF erased_at ON people
     BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
  ).run();
}

describe("erasure, all or nothing", () => {
  it("erases a client with something in every table it deletes from, and counts what went", async () => {
    const personId = await clientWithEverything();
    await openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now: NOW });

    const response = await erase(personId);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ visit_photos_deleted: 1, sessions_ended: 1, addresses_removed: 2 });
    expect(await filesLeft()).toEqual({ upload: false, result: false, visitPhoto: false, card: false });
    const left = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM number_change_requests) AS changes, (SELECT COUNT(*) FROM otp_challenges) AS codes,
         (SELECT COUNT(*) FROM photos) AS photos, (SELECT COUNT(*) FROM photo_sets) AS sets,
         (SELECT COUNT(*) FROM waitlist_entries) AS waiting`,
    ).first();
    expect(left).toEqual({ changes: 0, codes: 0, photos: 0, sets: 0, waiting: 0 });
    // The check-in keeps its evidence; the address it was measured against keeps only its city and pincode.
    const checkin = await env.DB.prepare("SELECT address_id, distance_m, passed FROM checkins").first();
    expect(checkin).toEqual({ address_id: "address-1", distance_m: 12, passed: 1 });
    const addresses = await env.DB.prepare(
      "SELECT id, line1, locality, city, pincode, lat, lng, access_notes, flat FROM addresses",
    ).all();
    expect(addresses.results).toEqual([
      {
        id: "address-1",
        line1: "Erased",
        locality: "Erased",
        city: "Gurgaon",
        pincode: "122018",
        lat: null,
        lng: null,
        access_notes: null,
        flat: null,
      },
    ]);
    const card = await env.DB.prepare("SELECT card_state, card_version, card_key FROM referral_codes").first();
    expect(card).toEqual({ card_state: "house", card_version: 3, card_key: null });
    const person = await env.DB.prepare("SELECT name, files_erased_at FROM people WHERE id = ?1")
      .bind(personId)
      .first();
    expect(person).toEqual({ name: "Erased", files_erased_at: NOW.toISOString() });
  });

  it("deletes a photograph taken again and every small copy, and takes all they held off the meter", async () => {
    const personId = await clientWithEverything();
    const retaken = `visits/${VISIT}/after-front-0.jpg`;
    const small = `visits/${VISIT}/after-front-1-small.jpg`;
    await env.DB.prepare("UPDATE photos SET thumbnail_key = ?1").bind(small).run();
    await putCounted(env.DB, env.CLIENT_PHOTOS, VISIT_PHOTO, syntheticJpeg(600, 800), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, retaken, syntheticJpeg(600, 800, "first take"), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, small, syntheticJpeg(300, 400), "image/jpeg");
    await putCounted(
      env.DB,
      env.CLIENT_PHOTOS,
      `visits/someone-else/after-front-9.jpg`,
      new Uint8Array(70),
      "image/jpeg",
    );
    await putCounted(env.DB, env.REFERRAL_CARDS, CARD, syntheticJpeg(1200, 630), "image/jpeg");

    await erasePerson(env, personId, NOW, createLogger());

    expect(await env.CLIENT_PHOTOS.head(retaken)).toBeNull();
    expect(await env.CLIENT_PHOTOS.head(small)).toBeNull();
    expect((await readMeter(env.DB)).bytes).toBe(70);
  });

  // An earlier attempt deleted them from R2 and failed before the meter heard: no listing finds them now.
  it("takes a visit's objects off the meter that an earlier attempt deleted from R2 alone", async () => {
    const personId = await clientWithEverything();
    const retaken = `visits/${VISIT}/after-front-0.jpg`;
    const small = `visits/${VISIT}/after-front-0-small.jpg`;
    await putCounted(env.DB, env.CLIENT_PHOTOS, retaken, syntheticJpeg(600, 800, "first take"), "image/jpeg");
    await putCounted(env.DB, env.CLIENT_PHOTOS, small, syntheticJpeg(300, 400), "image/jpeg");
    // Another visit whose ID begins with this one's, which must keep its count.
    await putCounted(env.DB, env.CLIENT_PHOTOS, `visits/${VISIT}0/after-front-9.jpg`, new Uint8Array(70), "image/jpeg");
    await env.CLIENT_PHOTOS.delete([retaken, small]);

    await erasePerson(env, personId, NOW, createLogger());

    expect((await readMeter(env.DB)).bytes).toBe(70);
    const left = await env.DB.prepare("SELECT key FROM stored_objects").all<{ key: string }>();
    expect(left.results.map((row) => row.key)).toEqual([`visits/${VISIT}0/after-front-9.jpg`]);
  });

  it("changes nothing, deletes no file and audits nothing, when the database refuses the erasure", async () => {
    const personId = await clientWithEverything();
    await databaseRefusesErasure();

    const response = await erase(personId);

    expect(response.status).toBe(500);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'person.erase'").first()).toEqual({
      n: 0,
    });
    expect(await filesLeft()).toEqual({ upload: true, result: true, visitPhoto: true, card: true });
    const person = await env.DB.prepare("SELECT name, erased_at FROM people WHERE mobile_e164 = ?1")
      .bind(MOBILE_E164)
      .first();
    expect(person).toEqual({ name: "Arjun Mehta", erased_at: null });
    expect(await env.DB.prepare("SELECT card_state FROM referral_codes").first("card_state")).toBe("personal");
    expect(await env.DB.prepare("SELECT lat, lng FROM checkins").first()).toEqual({ lat: 28.39, lng: 77.06 });
    // So it can simply be asked for again.
    await env.DB.prepare("DROP TRIGGER refuse_erasure").run();
    expect(await statusOf(personId)).toBe(200);
  });

  it("erases the person when R2 fails, and the cron deletes the files left", async () => {
    const personId = await clientWithEverything();
    const unavailable = () => Promise.reject(new Error("R2 unavailable"));
    const failingPhotos = { head: unavailable, list: unavailable, delete: unavailable } as unknown as R2Bucket;

    const summary = await erasePerson({ ...env, CLIENT_PHOTOS: failingPhotos }, personId, NOW, createLogger());

    expect(summary?.personId).toBe(personId);
    const erased = await env.DB.prepare("SELECT name, files_erased_at FROM people WHERE id = ?1")
      .bind(personId)
      .first();
    expect(erased).toEqual({ name: "Erased", files_erased_at: null });
    expect((await filesLeft()).visitPhoto).toBe(true);
    expect(logs.lines().some((line) => line.event === "erasure_files_left")).toBe(true);

    const later = new Date(NOW.getTime() + 5 * 60_000);
    const job = CRON_JOBS.filter((cronJob) => cronJob.name === "erased_files");
    const outcomes = await runCronJobs(job, {
      env,
      deps: fakeDependencies({ now: () => later }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "erased_files", ok: true }]);
    expect(await filesLeft()).toEqual({ upload: false, result: false, visitPhoto: false, card: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS photos FROM photos").first()).toEqual({ photos: 0 });
    const done = await env.DB.prepare("SELECT files_erased_at FROM people WHERE id = ?1").bind(personId).first();
    expect(done).toEqual({ files_erased_at: later.toISOString() });
  });
});

// A reason is ops' own words about a client, kept with the decision (docs/decisions/0072-ops-clients-and-queues.md):
// "same flat as Rohit" is a personal detail, so it goes with the rest of what an erasure blanks.
describe("erasure blanks what ops wrote about the client", () => {
  const FRIEND = "friend-1";
  const REFERRER = "referrer-1";

  async function reasonsWritten(): Promise<void> {
    const at = NOW.toISOString();
    await env.DB.batch([
      ...[
        [REFERRER, "+919810000011", "Vikram Sood"],
        [FRIEND, "+919810000012", "Kabir Anand"],
      ].map(([id, mobile, name]) =>
        env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
          id,
          at,
          mobile,
          name,
        ),
      ),
      env.DB.prepare(
        "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('VSAB23', ?1, ?2, ?2)",
      ).bind(REFERRER, at),
      env.DB.prepare(
        `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
           review_reason, reviewed_by, reviewed_at, attached_by, attach_reason, created_at, updated_at)
         VALUES ('referral-1', 'VSAB23', ?1, ?2, 'consultation', 'rejected', 'Same flat as Vikram', 'ops@localhost',
           ?2, 'ops@localhost', 'Named Vikram on WhatsApp', ?2, ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, technician_id,
           fsm_modified_at, synced_at)
         VALUES ('visit-9', 'fsm-9', ?1, 'service', 'terminated', 'Terminated', '2026-09-19T03:30:00.000Z', 't1', ?2, ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-9', 'visit-9', 't1', ?1, 28.4, 77.0, 200, 1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           decided_by, decided_at, decision_reason, created_at)
         VALUES ('case-9', 'checkin-9', 'visit-9', ?1, ?1, ?1, 'charged', 'ops@localhost', ?1,
           'His wife said he forgets', ?1)`,
      ).bind(at),
      // Why ops closed a visit of his left partly done without a follow-up (docs/decisions/0092-task-owners.md).
      env.DB.prepare(
        `INSERT INTO task_closures (id, task_group, subject_id, reason, closed_by, closed_at)
         VALUES ('closing-9', 'partial_visit', 'visit-9', 'Moving to Pune, wants no more visits', 'ops@localhost', ?1)`,
      ).bind(at),
      // The visit ops closed by hand when Imran's phone was lost, and another they cancelled for him.
      env.DB.prepare(
        `INSERT INTO visits (id, appointment_id, outcome, updated_at, closed_by, close_reason)
         VALUES ('visit-row-9', 'visit-9', 'partial', ?1, 'ops@localhost', 'He had to leave for the hospital')`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, synced_at)
         VALUES ('visit-10', 'visit-10', ?1, 'service', 'cancelled', '2026-09-24T03:30:00.000Z', ?2)`,
      ).bind(FRIEND, at),
      env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, created_at, cancelled_by,
           cancel_reason, ops_terms)
         VALUES ('change-10', 'visit-10', ?1, 'cancelled', 'late', '2026-09-24T03:30:00.000Z', ?2, 'ops@localhost',
           'His mother is unwell', 'free')`,
      ).bind(FRIEND, at),
      // A visit of his ops moved onto a day they had blacked out.
      env.DB.prepare(
        `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
           reason, actor, fsm_write_state, created_at, updated_at, blackout_reason)
         VALUES ('move-9', 'visit-9', 't1', 't1', '2026-09-18T03:30:00.000Z', '2026-09-19T03:30:00.000Z',
           'client_asked', 'ops@localhost', 'written', ?1, ?1, 'His only day off before the wedding')`,
      ).bind(at),
    ]);
  }

  const reasons = () =>
    env.DB.prepare(
      `SELECT (SELECT review_reason FROM referral_attributions) AS review,
         (SELECT attach_reason FROM referral_attributions) AS attach,
         (SELECT decision_reason FROM no_show_cases) AS no_show,
         (SELECT reason FROM task_closures) AS closed,
         (SELECT close_reason FROM visits) AS closed_by_hand,
         (SELECT cancel_reason FROM visit_changes) AS cancelled,
         (SELECT blackout_reason FROM dispatch_moves) AS moved_onto_blackout`,
    ).first();

  it("blanks the reasons ops gave about the friend: the invite attached, the grant's review, the no-show ruling, a visit's task closed, a visit closed by hand, one cancelled and one moved onto a blacked-out day", async () => {
    await reasonsWritten();

    expect(await erasePerson(env, FRIEND, NOW, createLogger())).not.toBeNull();

    expect(await reasons()).toEqual({
      review: null,
      attach: null,
      no_show: null,
      closed: null,
      closed_by_hand: null,
      cancelled: null,
      moved_onto_blackout: null,
    });
    // The decisions themselves stay, as records.
    const ruled = await env.DB.prepare(
      "SELECT (SELECT grant_state FROM referral_attributions) AS grant_state, (SELECT decision FROM no_show_cases) AS decision",
    ).first();
    expect(ruled).toEqual({ grant_state: "rejected", decision: "charged" });
  });

  // Which member of staff took their address on the phone is about the client too (docs/decisions/0092-task-owners.md);
  // the audit log, which an erasure cannot reach, still says who saved one.
  it("blanks who in ops took the friend's address on the phone, and keeps the log's entry", async () => {
    await reasonsWritten();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, given_to_staff)
         VALUES ('address-9', ?1, ?2, 'Flat 9, Palm Grove', 'Sector 65', 'Gurgaon', '122018', 'priya@maneman.in')`,
      ).bind(FRIEND, NOW.toISOString()),
      // The check-in was measured against it, so it is blanked rather than deleted.
      env.DB.prepare("UPDATE checkins SET address_id = 'address-9' WHERE id = 'checkin-9'"),
      env.DB.prepare(
        `INSERT INTO audit_log (at, surface, actor_kind, actor, action, subject_kind, subject_id, request_id)
         VALUES (?2, 'ops', 'staff', 'priya@maneman.in', 'address.given_to_ops', 'person', ?1, 'r')`,
      ).bind(FRIEND, NOW.toISOString()),
    ]);

    await erasePerson(env, FRIEND, NOW, createLogger());

    expect(await env.DB.prepare("SELECT line1, given_to_staff FROM addresses").all()).toMatchObject({
      results: [{ line1: "Erased", given_to_staff: null }],
    });
    expect(await env.DB.prepare("SELECT actor FROM audit_log WHERE action = 'address.given_to_ops'").first()).toEqual({
      actor: "priya@maneman.in",
    });
  });

  it("blanks the grant's review reason when the referrer is the one erased", async () => {
    await reasonsWritten();

    await erasePerson(env, REFERRER, NOW, createLogger());

    expect(await reasons()).toEqual({
      review: null,
      attach: null,
      no_show: "His wife said he forgets",
      closed: "Moving to Pune, wants no more visits",
      closed_by_hand: "He had to leave for the hospital",
      cancelled: "His mother is unwell",
      moved_onto_blackout: "His only day off before the wedding",
    });
  });

  it("blanks nothing when the database refuses the erasure", async () => {
    await reasonsWritten();
    await databaseRefusesErasure();

    await expect(erasePerson(env, FRIEND, NOW, createLogger())).rejects.toThrow();

    expect(await reasons()).toEqual({
      review: "Same flat as Vikram",
      attach: "Named Vikram on WhatsApp",
      no_show: "His wife said he forgets",
      closed: "Moving to Pune, wants no more visits",
      closed_by_hand: "He had to leave for the hospital",
      cancelled: "His mother is unwell",
      moved_onto_blackout: "His only day off before the wedding",
    });
  });
});

// Confirmed by the owner on 27 September 2026 with ruling 34 (docs/decisions/0094-where-a-consent-was-given.md).
describe("erasure blanks a check-in's coordinates", () => {
  const checkins = () =>
    env.DB.prepare(
      `SELECT id, lat, lng, accuracy_m, at, address_id, distance_m, radius_m, passed FROM checkins ORDER BY id`,
    ).all();

  it("takes where the technician's phone was off each of the client's check-ins, and keeps whether it passed", async () => {
    const personId = await clientWithEverything();
    const at = NOW.toISOString();
    // A second check-in of theirs, with nothing to measure against, and another client's, at their own door.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, accuracy_m, radius_m, passed, created_at)
         VALUES ('checkin-2', ?1, 't1', ?2, 28.41, 77.05, 9.5, 200, 1, ?2)`,
      ).bind(VISIT, at),
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('other', ?1, '+919810000077', 'Kabir Anand')",
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, technician_id,
           fsm_modified_at, synced_at)
         VALUES ('visit-other', 'fsm-other', 'other', 'service', 'completed', 'Completed', ?1, 't1', ?1, ?1)`,
      ).bind(at),
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, accuracy_m, radius_m, passed, created_at)
         VALUES ('checkin-other', 'visit-other', 't1', ?1, 28.5, 77.1, 6, 200, 1, ?1)`,
      ).bind(at),
    ]);

    expect(await statusOf(personId)).toBe(200);

    const kept = { at, radius_m: 200, passed: 1 };
    expect((await checkins()).results).toEqual([
      { id: "checkin-1", lat: null, lng: null, accuracy_m: null, address_id: "address-1", distance_m: 12, ...kept },
      { id: "checkin-2", lat: null, lng: null, accuracy_m: null, address_id: null, distance_m: null, ...kept },
      { id: "checkin-other", lat: 28.5, lng: 77.1, accuracy_m: 6, address_id: null, distance_m: null, ...kept },
    ]);
  });
});

describe("erasure blanks what a pay step kept on a hold", () => {
  it("takes the purposes shown and the client's hashed address off their holds, and keeps the hold", async () => {
    const personId = await clientWithEverything();
    const at = NOW.toISOString();
    await env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at, consents_shown, consents_ip_hash)
       VALUES ('hold-1', ?1, 'service', '2026-09-24', 'afternoon', 't1', 2, 200000, 169492, 18, 'released', ?2, ?2,
         ?2, 'photos_own_record,photos_referral_cards', 'a-hash')`,
    )
      .bind(personId, at)
      .run();

    expect(await statusOf(personId)).toBe(200);

    const hold = await env.DB.prepare(
      "SELECT state, consents_shown, consents_ip_hash FROM slot_holds WHERE id = 'hold-1'",
    ).first();
    expect(hold).toEqual({ state: "released", consents_shown: null, consents_ip_hash: null });
  });
});

/** A visit still to happen, paid for, as a client's Monday service is. */
async function bookedVisit(personId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
     VALUES ('visit-live', 'fsm-live', ?1, 'service', 'scheduled', 'Scheduled', '2026-09-28T03:30:00.000Z', ?2, ?2)`,
  )
    .bind(personId, NOW.toISOString())
    .run();
}

/** A payment we captured and hold, with no visit behind it. */
async function paymentHeld(personId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
       created_at, updated_at)
     VALUES ('payment-1', 'MM-2026-0001', ?1, 'pay_1', 200000, 'INR', 'captured', ?2, ?2, ?2)`,
  )
    .bind(personId, NOW.toISOString())
    .run();
}

describe("erasure while something is still owed", () => {
  it("refuses a client with a visit booked, and names the visit", async () => {
    const personId = await book();
    await bookedVisit(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "visit_booked", request_id: expect.any(String) as string },
      visits: [{ id: "visit-live", type: "service", status: "scheduled", window_start: "2026-09-28T03:30:00.000Z" }],
      bookings: [],
      payments: [],
      links: [],
    });
    expect(await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first()).toEqual({
      erased_at: null,
    });
  });

  it("refuses a client whose payment we hold with no visit behind it, and names the payment", async () => {
    const personId = await book();
    await paymentHeld(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_held" },
      visits: [],
      payments: [{ id: "payment-1", reference: "MM-2026-0001", amount: 200000 }],
    });
  });

  it("erases anyway when ops say they will settle both by hand today, and the log says so", async () => {
    const personId = await book();
    await bookedVisit(personId);
    await paymentHeld(personId);

    expect(await statusOf(personId, { body: { override_open_bookings: true } })).toBe(200);

    const entry = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'person.erase'").first("detail");
    expect(entry).toBe(JSON.stringify({ settled_by_hand: true, visits: 1, bookings: 0, payments: 1, links: 0 }));
  });
});

/** Imran, whose Wednesday a booking holds. */
async function technician(): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)",
  )
    .bind(NOW.toISOString())
    .run();
}

interface Holding {
  readonly id: string;
  readonly window?: "morning" | "afternoon";
  readonly amount: number;
  readonly confirmedAt: string | null;
  readonly expiresAt: string;
  readonly payByLink?: { readonly linkId: string; readonly reference: string };
  readonly orderId?: string;
}

/** A booking of theirs not yet a visit, holding a window of Imran's Wednesday, the morning unless said. */
async function holding(personId: string, hold: Holding): Promise<void> {
  const at = NOW.toISOString();
  const window = hold.window ?? "morning";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
         gst_percent, state, expires_at, created_at, updated_at, confirmed_at, queued_at, pay_by_link, payment_link_id,
         reference, razorpay_order_id)
       VALUES (?1, ?2, 'consultation', '2026-09-23', ?11, 't1', 0, ?3, ?3, 0, 'held', ?4, ?5, ?5, ?6, ?6, ?7, ?8, ?9,
         ?10)`,
    ).bind(
      hold.id,
      personId,
      hold.amount,
      hold.expiresAt,
      at,
      hold.confirmedAt,
      hold.payByLink === undefined ? 0 : 1,
      hold.payByLink?.linkId ?? null,
      hold.payByLink?.reference ?? null,
      hold.orderId ?? null,
      window,
    ),
    env.DB.prepare(
      "INSERT INTO slot_claims (technician_id, date, claim, hold_id) VALUES ('t1', '2026-09-23', ?1, ?2)",
    ).bind(`window:${window}`, hold.id),
  ]);
}

const AN_HOUR_ON = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();

/** The audit's X10: a free consultation confirmed, and not yet a visit. */
const freeBooking = (personId: string) =>
  holding(personId, { id: "hold-free", amount: 0, confirmedAt: NOW.toISOString(), expiresAt: NOW.toISOString() });

/** A visit ops booked, its slot held while the payment link they sent is open. */
const bookingByLink = (personId: string, expiresAt = AN_HOUR_ON) =>
  holding(personId, {
    id: "hold-link",
    window: "afternoon",
    amount: 200000,
    confirmedAt: null,
    expiresAt,
    payByLink: { linkId: "plink_hold", reference: "MM-2026-0002" },
  });

/** A consultation and fit in one visit, fitted last week, whose link Razorpay sent and nobody has paid. */
async function fittedVisitUnpaid(personId: string): Promise<void> {
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
         synced_at, one_visit)
       VALUES ('visit-fitted', 'visit-fitted', ?1, 'first_fit', 'completed', NULL, '2026-09-14T03:30:00.000Z', ?2, ?2,
         'booked')`,
    ).bind(personId, at),
    env.DB.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
         short_url, sent_at, reference, created_at, updated_at)
       VALUES ('link-1', 'visit-fitted', 'standard', 4500000, 3813559, 18, 'plink_visit', 'https://rzp.io/i/v', ?1,
         'MM-2026-0003', ?1, ?1)`,
    ).bind(at),
  ]);
}

const holdStates = async () => (await env.DB.prepare("SELECT id, state FROM slot_holds ORDER BY id").all()).results;
const claimsLeft = async () => (await env.DB.prepare("SELECT hold_id FROM slot_claims").all()).results;
const erasedAt = async (personId: string) =>
  env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first("erased_at");

describe("erasure while a booking is not yet a visit, or a payment link is unpaid", () => {
  beforeEach(technician);

  it("refuses a client whose free consultation is confirmed but not yet a visit, names it, and keeps it", async () => {
    const personId = await book();
    await freeBooking(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "visit_booked" },
      visits: [],
      bookings: [{ id: "hold-free", type: "consultation", date: "2026-09-23", window: "morning" }],
      links: [],
    });
    expect(await erasedAt(personId)).toBeNull();
    expect(await holdStates()).toEqual([{ id: "hold-free", state: "held" }]);
  });

  it("refuses a client whose fitted visit's payment link is unpaid, and names the link", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_owed" },
      links: [{ id: "link-1", reference: "MM-2026-0003", amount: 4500000 }],
    });
    expect(await erasedAt(personId)).toBeNull();
  });

  it("refuses a client with a payment link open for a booking, and names the booking's link", async () => {
    const personId = await book();
    await bookingByLink(personId);

    const response = await erase(personId);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_owed" },
      bookings: [],
      links: [{ id: "hold-link", reference: "MM-2026-0002", amount: 200000 }],
    });
  });

  it("is not held up by a booking's link that has closed, and asks Razorpay to cancel nothing", async () => {
    const personId = await book();
    await bookingByLink(personId, NOW.toISOString());
    const deps = fakeDependencies();

    expect(await statusOf(personId, { deps })).toBe(200);

    expect((deps.payments as StubPayments).made.cancelledLinks).toEqual([]);
  });

  it("erases anyway when ops say so: lets go of the bookings and their time, and cancels the open links", async () => {
    const personId = await book();
    await freeBooking(personId);
    await bookingByLink(personId);
    await fittedVisitUnpaid(personId);
    const deps = fakeDependencies();

    expect(await statusOf(personId, { deps, body: { override_open_bookings: true } })).toBe(200);

    expect(await holdStates()).toEqual([
      { id: "hold-free", state: "released" },
      { id: "hold-link", state: "released" },
    ]);
    expect(await claimsLeft()).toEqual([]);
    expect((deps.payments as StubPayments).made.cancelledLinks).toEqual(["plink_visit", "plink_hold"]);
    const entry = await env.DB.prepare("SELECT detail FROM audit_log WHERE action = 'person.erase'").first("detail");
    expect(entry).toBe(JSON.stringify({ settled_by_hand: true, visits: 0, bookings: 1, payments: 0, links: 2 }));
  });

  it("still erases when Razorpay will not cancel a link, and tells ops its ID to cancel by hand", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    const refusing = createStubPayments();
    const deps = fakeDependencies({
      payments: { ...refusing, cancelPaymentLink: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")) },
    });

    expect(await statusOf(personId, { deps, body: { override_open_bookings: true } })).toBe(200);

    expect(await erasedAt(personId)).not.toBeNull();
    expect(await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL").all()).toMatchObject({
      results: [{ key: "erased_link:plink_visit" }],
    });
    expect(deps.alerts.join("\n")).toContain("plink_visit");
  });
});

describe("a booking of a client erased since", () => {
  beforeEach(technician);

  it("is let go by the erasure, and a payment for it that comes in afterwards goes back rather than booking it", async () => {
    const personId = await book();
    await holding(personId, {
      id: "hold-paying",
      amount: 200000,
      confirmedAt: null,
      expiresAt: AN_HOUR_ON,
      orderId: "order_late",
    });
    expect(await statusOf(personId)).toBe(200);
    expect(await holdStates()).toEqual([{ id: "hold-paying", state: "released" }]);

    // Razorpay's webhook records the capture and confirms the hold, then asks for the booking.
    const at = NOW.toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_order_id, razorpay_payment_id, amount, currency, status,
           captured_at, created_at, updated_at)
         VALUES ('payment-late', ?1, 'order_late', 'pay_late', 200000, 'INR', 'captured', ?2, ?2, ?2)`,
      ).bind(personId, at),
      env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?1 WHERE id = 'hold-paying'").bind(at),
    ]);
    const payments = createStubPayments();
    const outcome = await confirmBooking(env.DB, createStubFsm(), payments, "hold-paying", NOW, {
      record: "ours",
      labelAsTest: true,
    });

    expect(outcome).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_late", amount: 200000 }]);
    expect(await env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1").bind(personId).all()).toMatchObject(
      {
        results: [],
      },
    );
    expect(await holdStates()).toEqual([{ id: "hold-paying", state: "released" }]);
  });

  it("is never written to FSM, and is let go, when a try for it still comes", async () => {
    const personId = await book();
    await freeBooking(personId);
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(personId, NOW.toISOString()).run();
    const fsm = createStubFsm();

    const outcome = await confirmBooking(env.DB, fsm, createStubPayments(), "hold-free", NOW, { labelAsTest: true });

    expect(outcome).toBe("lapsed");
    expect(fsm.made.workOrders).toEqual([]);
    expect(await holdStates()).toEqual([{ id: "hold-free", state: "released" }]);
    expect(await claimsLeft()).toEqual([]);
  });

  it("never has a payment link asked of Razorpay for it", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    await env.DB.batch([
      env.DB.prepare("UPDATE payment_links SET razorpay_link_id = NULL, short_url = NULL, sent_at = NULL"),
      env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(personId, NOW.toISOString()),
    ]);
    const deps = fakeDependencies();

    const sent = await sendUnsentLinks(env.DB, { ...deps, log: createLogger() }, NOW, createCallBudget(10));

    expect(sent).toBe(0);
    expect((deps.payments as StubPayments).made.links).toEqual([]);
  });
});

describe("ops deciding a deletion", () => {
  const ops = () => appFor("local", fakeDependencies(), {}, "ops");

  async function requested(personId: string): Promise<string> {
    await env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES ('7c9e6679-7425-40de-944b-e07fc1f90ae7', ?1, ?2, 'requested')",
    )
      .bind(personId, NOW.toISOString())
      .run();
    return "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  }

  function decide(id: string, decision: "delete" | "reject", reason: string | null = null) {
    return request(
      ops(),
      `/api/deletion-requests/${id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
        body: JSON.stringify({ decision, reason }),
      },
      { CRM_QUEUE: fakeQueue(), FSM_QUEUE: fakeQueue() },
    );
  }

  const decisions = async () =>
    (await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action = 'deletion.decide'").all()).results;

  it("audits the decision with the erasure, so a refused erasure leaves no entry and the request waiting", async () => {
    const id = await requested(await clientWithEverything());
    await databaseRefusesErasure();

    expect((await decide(id, "delete")).status).toBe(500);

    expect(await decisions()).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
    expect(await filesLeft()).toEqual({ upload: true, result: true, visitPhoto: true, card: true });
  });

  it("records one decision when the erasure is done", async () => {
    const id = await requested(await clientWithEverything());

    expect(await (await decide(id, "delete")).json()).toEqual({ state: "done" });

    expect(await decisions()).toEqual([{ action: "deletion.decide", detail: JSON.stringify({ decision: "delete" }) }]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("done");
  });

  it("refuses to delete while a visit is booked, names it, and leaves the request waiting", async () => {
    const personId = await book();
    await bookedVisit(personId);
    const id = await requested(personId);

    const response = await decide(id, "delete");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "visit_booked" },
      visits: [{ id: "visit-live", type: "service" }],
    });
    expect(await decisions()).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
  });

  it("refuses to delete while a payment link is unpaid, names it, and leaves the request waiting", async () => {
    const personId = await book();
    await fittedVisitUnpaid(personId);
    const id = await requested(personId);

    const response = await decide(id, "delete");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "payment_owed" }, links: [{ id: "link-1" }] });
    expect(await env.DB.prepare("SELECT state FROM deletion_requests").first("state")).toBe("requested");
  });

  it("still lets ops reject a request while a visit is booked", async () => {
    const personId = await book();
    await bookedVisit(personId);
    const id = await requested(personId);

    expect(await (await decide(id, "reject", "Not the number's owner")).json()).toEqual({ state: "rejected" });
    expect(await decisions()).toEqual([{ action: "deletion.decide", detail: JSON.stringify({ decision: "reject" }) }]);
  });
});

describe("secretsMatch", () => {
  it("matches only the same secret, and never an unset one", async () => {
    expect(await secretsMatch("a-secret", "a-secret")).toBe(true);
    expect(await secretsMatch("a-secret", "a-secreT")).toBe(false);
    expect(await secretsMatch("a-secret-but-longer", "a-secret")).toBe(false);
    expect(await secretsMatch("", "")).toBe(false);
  });
});

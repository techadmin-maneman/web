import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { erasePerson } from "../../src/domain/erasure.ts";
import { secretsMatch } from "../../src/lib/hash.ts";
import { createLogger } from "../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  LOCAL_CONFIG,
  LOCAL_SETTINGS,
  NOW,
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  request,
} from "./helpers.ts";
import { insertJob, syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const MOBILE = "9810000001";
const MOBILE_E164 = "+919810000001";
const AUTHORIZED = { Authorization: `Bearer ${LOCAL_SETTINGS.erasureSecret}` };

async function book(mobile = MOBILE): Promise<string> {
  const response = await request(
    appFor(),
    "/api/lead",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Arjun Mehta",
        mobile,
        city: "Gurgaon",
        first_choice_window: "weekday_am",
        loss_extent: "crown",
        consent: true,
        turnstile_token: "token",
      }),
    },
    { CRM_QUEUE: fakeQueue() },
  );
  expect(response.status).toBe(201);
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

function erase(body: unknown, headers: Record<string, string> = AUTHORIZED, queue = fakeQueue()) {
  return request(
    appFor(),
    "/api/erasure",
    { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) },
    { CRM_QUEUE: queue },
  );
}

let logs: ReturnType<typeof captureLogs>;
beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

describe("POST /api/erasure", () => {
  it("deletes the photos and results, blanks the person, cancels unsent messages and queues the CRM", async () => {
    const personId = await personWithHistory();
    const crmQueue = fakeQueue();

    const response = await erase({ mobile: "98100 00001" }, AUTHORIZED, crmQueue);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      person_id: personId,
      erased_at: NOW.toISOString(),
      photos_deleted: 2,
      results_deleted: 1,
      messages_cancelled: 2,
      crm: "queued",
    });
    expect(crmQueue.sent).toEqual([{ erase_person_id: personId, request_id: expect.any(String) as string }]);

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
      "SELECT purpose FROM consents WHERE person_id = ? AND notice_version = 'withdrawal' AND granted = 0 ORDER BY purpose",
    )
      .bind(personId)
      .all<{ purpose: string }>();
    expect(withdrawals.results.map((row) => row.purpose)).toEqual(["contact", "result_delivery"]);
    const event = await env.DB.prepare(
      "SELECT payload_json FROM events WHERE name = 'person_erased' AND subject_id = ?",
    )
      .bind(personId)
      .first<{ payload_json: string }>();
    expect(JSON.parse(event?.payload_json ?? "{}")).toEqual({ photos: 2, results: 1 });
  });

  it("never writes the person's name, number or e-mail to the logs", async () => {
    await personWithHistory();
    await erase({ mobile: MOBILE });
    const written = JSON.stringify(logs.lines());
    expect(written).toContain("person_erased");
    for (const secret of ["Arjun", "9810000001", "arjun@example.com"]) expect(written).not.toContain(secret);
  });

  it("answers 404 for a number it does not know, including one already erased", async () => {
    expect((await erase({ mobile: MOBILE })).status).toBe(404);
    await book();
    expect((await erase({ mobile: MOBILE })).status).toBe(200);
    expect((await erase({ mobile: MOBILE })).status).toBe(404);
  });

  it("lets the number book again afterwards, as a new person needing a new consent", async () => {
    const erased = await book();
    await erase({ mobile: MOBILE });
    const again = await book();
    expect(again).not.toBe(erased);
    const consents = await env.DB.prepare("SELECT COUNT(*) AS n FROM consents WHERE person_id = ?")
      .bind(again)
      .first<{ n: number }>();
    expect(consents?.n).toBe(1);
  });

  it("refuses a missing, wrong or unprefixed secret", async () => {
    await book();
    const refused: Record<string, string>[] = [
      {},
      { Authorization: "Bearer not-the-erasure-secret-at-all-00000000" },
      { Authorization: LOCAL_SETTINGS.erasureSecret },
      { Authorization: "Bearer " },
    ];
    for (const headers of refused) {
      const response = await erase({ mobile: MOBILE }, headers);
      expect(response.status).toBe(401);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe("unauthorized");
    }
    const person = await env.DB.prepare("SELECT erased_at FROM people WHERE mobile_e164 = ?")
      .bind(MOBILE_E164)
      .first<{ erased_at: string | null }>();
    expect(person?.erased_at).toBeNull();
  });

  it("refuses a body that is not one Indian mobile number", async () => {
    for (const body of [{}, { mobile: "12345" }, { mobile: MOBILE, name: "Arjun" }]) {
      expect((await erase(body)).status).toBe(400);
    }
  });

  it("still erases when the CRM queue is down, leaving the CRM to the sweeper", async () => {
    await book();
    const downQueue = { send: () => Promise.reject(new Error("queue unavailable")) } as unknown as ReturnType<
      typeof fakeQueue
    >;
    const response = await erase({ mobile: MOBILE }, AUTHORIZED, downQueue);
    expect(response.status).toBe(200);
    expect(logs.lines().some((line) => line.event === "crm_enqueue_failed")).toBe(true);
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
  it("erases a client with something in every table it deletes from", async () => {
    const personId = await clientWithEverything();

    const response = await erase({ mobile: MOBILE });

    expect(response.status).toBe(200);
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

  it("changes nothing, and deletes no file, when the database refuses the erasure", async () => {
    await clientWithEverything();
    await databaseRefusesErasure();

    const response = await erase({ mobile: MOBILE });

    expect(response.status).toBe(500);
    expect(await filesLeft()).toEqual({ upload: true, result: true, visitPhoto: true, card: true });
    const person = await env.DB.prepare("SELECT name, erased_at FROM people WHERE mobile_e164 = ?1")
      .bind(MOBILE_E164)
      .first();
    expect(person).toEqual({ name: "Arjun Mehta", erased_at: null });
    expect(await env.DB.prepare("SELECT card_state FROM referral_codes").first("card_state")).toBe("personal");
    // So it can simply be asked for again.
    await env.DB.prepare("DROP TRIGGER refuse_erasure").run();
    expect((await erase({ mobile: MOBILE })).status).toBe(200);
  });

  it("erases the person when R2 fails, and the cron deletes the files left", async () => {
    const personId = await clientWithEverything();
    const failingPhotos = {
      delete: () => Promise.reject(new Error("R2 unavailable")),
    } as unknown as R2Bucket;

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
           review_reason, reviewed_by, reviewed_at, created_at, updated_at)
         VALUES ('referral-1', 'VSAB23', ?1, ?2, 'consultation', 'rejected', 'Same flat as Vikram', 'ops@localhost',
           ?2, ?2, ?2)`,
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
    ]);
  }

  const reasons = () =>
    env.DB.prepare(
      `SELECT (SELECT review_reason FROM referral_attributions) AS review,
         (SELECT decision_reason FROM no_show_cases) AS no_show`,
    ).first();

  it("blanks the reasons ops gave about the friend: the grant's review and the no-show ruling", async () => {
    await reasonsWritten();

    expect(await erasePerson(env, FRIEND, NOW, createLogger())).not.toBeNull();

    expect(await reasons()).toEqual({ review: null, no_show: null });
    // The decisions themselves stay, as records.
    const ruled = await env.DB.prepare(
      "SELECT (SELECT grant_state FROM referral_attributions) AS grant_state, (SELECT decision FROM no_show_cases) AS decision",
    ).first();
    expect(ruled).toEqual({ grant_state: "rejected", decision: "charged" });
  });

  it("blanks the grant's review reason when the referrer is the one erased", async () => {
    await reasonsWritten();

    await erasePerson(env, REFERRER, NOW, createLogger());

    expect(await reasons()).toEqual({ review: null, no_show: "His wife said he forgets" });
  });

  it("blanks nothing when the database refuses the erasure", async () => {
    await reasonsWritten();
    await databaseRefusesErasure();

    await expect(erasePerson(env, FRIEND, NOW, createLogger())).rejects.toThrow();

    expect(await reasons()).toEqual({ review: "Same flat as Vikram", no_show: "His wife said he forgets" });
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

    const response = await erase({ mobile: MOBILE });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "visit_booked", request_id: expect.any(String) as string },
      visits: [{ id: "visit-live", type: "service", status: "scheduled", window_start: "2026-09-28T03:30:00.000Z" }],
      payments: [],
    });
    expect(await env.DB.prepare("SELECT erased_at FROM people WHERE id = ?1").bind(personId).first()).toEqual({
      erased_at: null,
    });
  });

  it("refuses a client whose payment we hold with no visit behind it, and names the payment", async () => {
    const personId = await book();
    await paymentHeld(personId);

    const response = await erase({ mobile: MOBILE });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "payment_held" },
      visits: [],
      payments: [{ id: "payment-1", reference: "MM-2026-0001", amount: 200000 }],
    });
  });

  it("erases anyway when the operator says they have settled both by hand", async () => {
    const personId = await book();
    await bookedVisit(personId);
    await paymentHeld(personId);

    const response = await erase({ mobile: MOBILE, override_open_bookings: true });

    expect(response.status).toBe(200);
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

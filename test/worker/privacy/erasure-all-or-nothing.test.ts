import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { putCounted, readMeter } from "../../../src/domain/platform/storage-meter.ts";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { openSession } from "../../../src/domain/sign-in/sessions.ts";
import { createLogger } from "../../../src/log.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import { captureLogs, fakeDependencies, LOCAL_CONFIG, markDatabase, NOW } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";
import {
  CARD,
  clientWithEverything,
  databaseRefusesErasure,
  erase,
  filesLeft,
  MOBILE_E164,
  statusOf,
  VISIT,
  VISIT_PHOTO,
} from "./erasure-fixtures.ts";

let logs: ReturnType<typeof captureLogs>;

beforeEach(async () => {
  await markDatabase();
  logs = captureLogs();
});

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
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: VISIT_PHOTO,
      bytes: syntheticJpeg(600, 800),
      contentType: "image/jpeg",
    });
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: retaken,
      bytes: syntheticJpeg(600, 800, "first take"),
      contentType: "image/jpeg",
    });
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: small,
      bytes: syntheticJpeg(300, 400),
      contentType: "image/jpeg",
    });
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: `visits/someone-else/after-front-9.jpg`,
      bytes: new Uint8Array(70),
      contentType: "image/jpeg",
    });
    await putCounted({
      db: env.DB,
      bucket: env.REFERRAL_CARDS,
      key: CARD,
      bytes: syntheticJpeg(1200, 630),
      contentType: "image/jpeg",
    });

    await erasePerson({ env, personId, now: NOW, log: createLogger() });

    expect(await env.CLIENT_PHOTOS.head(retaken)).toBeNull();
    expect(await env.CLIENT_PHOTOS.head(small)).toBeNull();
    expect((await readMeter(env.DB)).bytes).toBe(70);
  });

  // An earlier attempt deleted them from R2 and failed before the meter heard: no listing finds them now.
  it("takes a visit's objects off the meter that an earlier attempt deleted from R2 alone", async () => {
    const personId = await clientWithEverything();
    const retaken = `visits/${VISIT}/after-front-0.jpg`;
    const small = `visits/${VISIT}/after-front-0-small.jpg`;
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: retaken,
      bytes: syntheticJpeg(600, 800, "first take"),
      contentType: "image/jpeg",
    });
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: small,
      bytes: syntheticJpeg(300, 400),
      contentType: "image/jpeg",
    });
    // Another visit whose ID begins with this one's, which must keep its count.
    await putCounted({
      db: env.DB,
      bucket: env.CLIENT_PHOTOS,
      key: `visits/${VISIT}0/after-front-9.jpg`,
      bytes: new Uint8Array(70),
      contentType: "image/jpeg",
    });
    await env.CLIENT_PHOTOS.delete([retaken, small]);

    await erasePerson({ env, personId, now: NOW, log: createLogger() });

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

    const summary = await erasePerson({
      env: { ...env, CLIENT_PHOTOS: failingPhotos },
      personId,
      now: NOW,
      log: createLogger(),
    });

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

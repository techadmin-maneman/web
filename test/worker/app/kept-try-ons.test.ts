// A client's try-on, kept: "Show the before photo always, keep the
// generated image till the photos for first fit are taken" (docs/decisions/0084-a-clients-try-on-is-kept.md).
// The small copy comes up with the photograph; the sweeper lets it go with the photograph or with the look, or keeps
// it, with the look, for a client; the look goes once the first fit is photographed; an erasure takes both.
// Every name and number is made up, and the "photographs" are synthetic.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_COPY_BYTES } from "../../../src/config/tryon.ts";
import { erasePerson } from "../../../src/domain/privacy/erasure.ts";
import { settleExpiringTryOns, type ExpiringTryOn } from "../../../src/domain/try-on/kept-try-ons.ts";
import { putCounted, readMeter } from "../../../src/domain/platform/storage-meter.ts";
import { signToken } from "../../../src/lib/signed-token.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { sweep, type SweepEnv } from "../../../src/scheduled/sweeper.ts";
import {
  LOCAL_SETTINGS,
  NOW,
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  markDatabase,
  request,
} from "../helpers.ts";
import { insertJob, insertPerson, syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";

const CLIENT = "person-client";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

const copyOf = (jobId: string) => `tryons/${jobId}/before.jpg`;
const COPY = syntheticJpeg(900, 1200);
const LOOK = syntheticPng(1200, 1600);
/** What the storage meter says the client-photos bucket holds. */
const metered = async () => (await readMeter(env.DB)).bytes;

function jobRow(id: string) {
  return env.DB.prepare("SELECT state, copy_key, kept_at, kept_look_key FROM tryon_jobs WHERE id = ?1")
    .bind(id)
    .first();
}

async function sweepNow(): Promise<void> {
  const bindings: SweepEnv = {
    DB: env.DB,
    UPLOADS: env.UPLOADS,
    RESULTS: env.RESULTS,
    CLIENT_PHOTOS: env.CLIENT_PHOTOS,
    CRM_QUEUE: fakeQueue(),
    RENDER_QUEUE: fakeQueue(),
    MESSAGE_QUEUE: fakeQueue(),
  };
  await sweep(bindings, fakeDependencies(), createLogger(), { budget: createCallBudget(Infinity) });
}

/** A try-on whose photograph, small copy and look are in their buckets, as the site and the render left them. */
async function tryOnWithCopy(id: string, columns: Record<string, string | number | null> = {}): Promise<void> {
  await insertJob({
    id,
    person_id: CLIENT,
    created_at: at(-2 * HOUR),
    uploaded_at: at(-2 * HOUR),
    state: "ready",
    result_key: `results/${id}.png`,
    expires_at: at(14 * DAY - 2 * HOUR),
    photo_consent_version: "photo-v2",
    copy_key: copyOf(id),
    number_proved_at: at(-2 * HOUR),
    ...columns,
  });
  await env.UPLOADS.put(`uploads/${id}`, syntheticJpeg(1200, 1600));
  if (columns.copy_key !== null) await putCounted(env.DB, env.CLIENT_PHOTOS, copyOf(id), COPY, "image/jpeg");
  await env.RESULTS.put(`results/${id}.png`, LOOK, { httpMetadata: { contentType: "image/png" } });
}

/** Past the look's day: the sweeper decides on its next run. */
async function lookDue(id: string): Promise<void> {
  await env.DB.prepare("UPDATE tryon_jobs SET expires_at = ?2 WHERE id = ?1").bind(id, at(-MINUTE)).run();
}

async function booksAVisit(personId = CLIENT, type = "consultation", appointmentId = `visit-${type}`): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
       fsm_modified_at, synced_at, first_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'scheduled', 'Scheduled', ?6, ?6, ?6)`,
  )
    .bind(appointmentId, `fsm-${appointmentId}`, personId, type, at(3 * DAY), NOW.toISOString())
    .run();
}

async function firstFitPhotographed(createdAt = NOW.toISOString()): Promise<void> {
  await booksAVisit(CLIENT, "first_fit", "visit-first-fit");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-fit', 'visit-first-fit', 'before', ?1)",
    ).bind(createdAt),
    env.DB.prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
       VALUES ('photo-fit', 'set-fit', 'front', 'visits/visit-first-fit/before-front.jpg', 'image/jpeg', 1000, ?1, ?1)`,
    ).bind(createdAt),
  ]);
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  await insertPerson(CLIENT, "+919810000001", "Rohit Malhotra");
});

describe("PUT /api/tryon/upload/{job_id}/copy", () => {
  const JOB = "0192a8e4-0000-7000-8000-000000000001";
  const OTHER = "0192a8e4-0000-7000-8000-000000000002";
  const NOT_YET = "0192a8e4-0000-7000-8000-000000000003";
  const PUBLISHED = "0192a8e4-0000-7000-8000-000000000004";
  const app = () => appFor("local", fakeDependencies());

  async function linkFor(jobId: string): Promise<string> {
    const token = await signToken(
      LOCAL_SETTINGS.tryon.linkSigningKey,
      "upload",
      jobId,
      new Date(NOW.getTime() + 5 * MINUTE),
    );
    return `/api/tryon/upload/${jobId}/copy?token=${token}`;
  }
  const put = async (jobId: string, bytes: Uint8Array, link?: string) =>
    request(app(), link ?? (await linkFor(jobId)), {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: bytes,
    });
  const uploaded = (id: string, notice = "photo-v2") =>
    insertJob({ id, state: "awaiting_upload", uploaded_at: NOW.toISOString(), photo_consent_version: notice });

  it("keeps a JPEG copy of up to 250 KB and 1600 px beside the photograph, once", async () => {
    await uploaded(JOB);
    const copy = syntheticJpeg(1200, 1600);

    expect((await put(JOB, copy)).status).toBe(204);

    expect(await jobRow(JOB)).toMatchObject({ copy_key: copyOf(JOB) });
    const stored = await env.CLIENT_PHOTOS.get(copyOf(JOB));
    expect(new Uint8Array(await (stored?.arrayBuffer() ?? new ArrayBuffer(0)))).toEqual(copy);
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(await metered()).toBe(copy.byteLength);
    // The one write each copy gets.
    expect((await put(JOB, copy)).status).toBe(409);
  });

  it("refuses anything but a small JPEG", async () => {
    await uploaded(JOB);
    const tooLarge = new Uint8Array(MAX_COPY_BYTES + 1);
    tooLarge.set(syntheticJpeg(1200, 1600));
    for (const bytes of [syntheticPng(1200, 1600), syntheticJpeg(1601, 1200), syntheticJpeg(150, 150), tooLarge]) {
      const response = await put(JOB, bytes);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "photo_invalid_file" } });
    }
    expect(await jobRow(JOB)).toMatchObject({ copy_key: null });
  });

  it("takes one only after the photograph, and only under a notice that keeps it", async () => {
    await insertJob({ id: NOT_YET, state: "awaiting_upload", photo_consent_version: "photo-v2" });
    await uploaded(PUBLISHED, "photo-v1");

    const early = await put(NOT_YET, syntheticJpeg(1200, 1600));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "upload_missing" } });
    const refused = await put(PUBLISHED, syntheticJpeg(1200, 1600));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "consent_required" } });
    expect(await env.CLIENT_PHOTOS.head(copyOf(PUBLISHED))).toBeNull();
  });

  it("opens only with the job's own upload link", async () => {
    await uploaded(JOB);
    await uploaded(OTHER);
    const othersToken = (await linkFor(OTHER)).split("?")[1] ?? "";
    expect((await put(JOB, syntheticJpeg(1200, 1600), `/api/tryon/upload/${JOB}/copy?${othersToken}`)).status).toBe(
      404,
    );
  });
});

describe("the sweeper, on a try-on's small copy", () => {
  it("deletes the copy of a try-on nobody claimed with its photograph, within the hour", async () => {
    await tryOnWithCopy("unclaimed", { person_id: null });

    await sweepNow();

    expect(await env.UPLOADS.head("uploads/unclaimed")).toBeNull();
    expect(await env.CLIENT_PHOTOS.head(copyOf("unclaimed"))).toBeNull();
    expect(await jobRow("unclaimed")).toMatchObject({ copy_key: null });
    expect(await metered()).toBe(0);
  });

  it("deletes the copy of a render that failed with its photograph, claimed or not", async () => {
    await tryOnWithCopy("failed", { state: "failed", result_key: null, expires_at: null });

    await sweepNow();

    expect(await env.CLIENT_PHOTOS.head(copyOf("failed"))).toBeNull();
  });

  it("holds a claimed try-on's copy as long as its look, and deletes both on the look's day if they never booked", async () => {
    await tryOnWithCopy("claimed");

    await sweepNow();
    expect(await env.UPLOADS.head("uploads/claimed")).toBeNull();
    expect(await env.CLIENT_PHOTOS.head(copyOf("claimed"))).not.toBeNull();

    await lookDue("claimed");
    await sweepNow();
    expect(await env.CLIENT_PHOTOS.head(copyOf("claimed"))).toBeNull();
    expect(await env.RESULTS.head("results/claimed.png")).toBeNull();
    expect(await jobRow("claimed")).toMatchObject({ state: "expired", copy_key: null, kept_at: null });
    expect(await metered()).toBe(0);
  });
});

describe("the sweeper, on a client's try-on", () => {
  // A claim whose number no code proved may hold a stranger's photograph, so it is never kept as theirs.
  it("lets go of a try-on whose claim no code proved, as of anyone who never booked", async () => {
    await tryOnWithCopy("unproved", { number_proved_at: null });
    await booksAVisit();
    await lookDue("unproved");

    await sweepNow();

    expect(await jobRow("unproved")).toMatchObject({ state: "expired", copy_key: null, kept_at: null });
    expect(await env.CLIENT_PHOTOS.head(copyOf("unproved"))).toBeNull();
    expect(await metered()).toBe(0);
  });

  it("keeps the copy for good, and moves the look where no lifecycle rule takes it, for a client who has booked", async () => {
    await tryOnWithCopy("client");
    await booksAVisit();
    await lookDue("client");

    await sweepNow();

    const look = "tryons/client/look.png";
    expect(await jobRow("client")).toMatchObject({
      state: "expired",
      copy_key: copyOf("client"),
      kept_at: NOW.toISOString(),
      kept_look_key: look,
    });
    expect(await env.CLIENT_PHOTOS.head(copyOf("client"))).not.toBeNull();
    const moved = await env.CLIENT_PHOTOS.get(look);
    expect(new Uint8Array(await (moved?.arrayBuffer() ?? new ArrayBuffer(0)))).toEqual(syntheticPng(1200, 1600));
    expect(moved?.httpMetadata?.contentType).toBe("image/png");
    expect(await env.RESULTS.head("results/client.png")).toBeNull();
    expect(await metered()).toBe(COPY.byteLength + LOOK.byteLength);
  });

  it("moves the look once when a sweep stopped before the try-on was expired, and counts it once", async () => {
    await tryOnWithCopy("client");
    await booksAVisit();
    await lookDue("client");
    const due = await env.DB.prepare(
      `SELECT id, created_at, person_id, photo_consent_version, state, result_key, expires_at, kept_at, copy_key,
         kept_look_key, number_proved_at
       FROM tryon_jobs WHERE id = 'client'`,
    ).first<ExpiringTryOn>();
    let reads = 0;
    const results = {
      get: (key: string) => {
        reads += 1;
        return env.RESULTS.get(key);
      },
    } as unknown as R2Bucket;
    const keeping = { DB: env.DB, RESULTS: results, CLIENT_PHOTOS: env.CLIENT_PHOTOS };

    await settleExpiringTryOns(keeping, due === null ? [] : [due], NOW);
    // The next run finds the same try-on, still ready, now kept and with its look moved.
    const again = await env.DB.prepare(
      `SELECT id, created_at, person_id, photo_consent_version, state, result_key, expires_at, kept_at, copy_key,
         kept_look_key, number_proved_at
       FROM tryon_jobs WHERE id = 'client'`,
    ).first<ExpiringTryOn>();
    expect(await settleExpiringTryOns(keeping, again === null ? [] : [again], NOW)).toBe(1);

    expect(reads).toBe(1);
    expect(await metered()).toBe(COPY.byteLength + LOOK.byteLength);
  });

  // Kept with nothing to show, it would hold the place of a later try-on the client could see.
  it("lets go of a client's try-on whose look is gone, so a later one can be kept", async () => {
    await tryOnWithCopy("lost", { created_at: at(-3 * DAY) });
    await env.RESULTS.delete("results/lost.png");
    await tryOnWithCopy("later");
    await booksAVisit();
    await lookDue("lost");
    await sweepNow();
    await lookDue("later");
    await sweepNow();

    expect(await jobRow("lost")).toMatchObject({ kept_at: null, copy_key: null, kept_look_key: null });
    expect(await env.CLIENT_PHOTOS.head(copyOf("lost"))).toBeNull();
    expect(await jobRow("later")).toMatchObject({ kept_at: NOW.toISOString(), kept_look_key: "tryons/later/look.png" });
  });

  it("counts a booking made on the site's form as well as a visit in the diary", async () => {
    await tryOnWithCopy("client");
    await env.DB.prepare(
      `INSERT INTO leads (id, person_id, created_at, source, proposed_visit_date, request_id)
       VALUES ('lead', ?1, ?2, 'form', '2026-09-25', 'r')`,
    )
      .bind(CLIENT, NOW.toISOString())
      .run();
    await lookDue("client");

    await sweepNow();

    expect(await jobRow("client")).toMatchObject({ kept_at: NOW.toISOString() });
  });

  it("keeps one try-on a client: the oldest, and lets the others go on their days", async () => {
    await tryOnWithCopy("first", { created_at: at(-3 * DAY) });
    await tryOnWithCopy("second");
    await booksAVisit();
    await lookDue("first");
    await sweepNow();
    await lookDue("second");
    await sweepNow();

    expect(await jobRow("first")).toMatchObject({ kept_at: NOW.toISOString() });
    expect(await jobRow("second")).toMatchObject({ kept_at: null, copy_key: null, kept_look_key: null });
    expect(await env.CLIENT_PHOTOS.head(copyOf("second"))).toBeNull();
  });

  it("keeps only the copy of a client whose first fit is photographed already", async () => {
    await tryOnWithCopy("fitted");
    await firstFitPhotographed(at(-30 * DAY));
    await lookDue("fitted");

    await sweepNow();

    expect(await jobRow("fitted")).toMatchObject({ kept_at: NOW.toISOString(), kept_look_key: null });
    expect(await env.CLIENT_PHOTOS.head(copyOf("fitted"))).not.toBeNull();
    expect(await env.RESULTS.head("results/fitted.png")).toBeNull();
  });

  it("deletes the kept look once a photograph of the first fit is stored, and not before", async () => {
    await tryOnWithCopy("client");
    await booksAVisit();
    await lookDue("client");
    await sweepNow();
    await booksAVisit(CLIENT, "first_fit", "visit-first-fit");

    await sweepNow();
    expect(await env.CLIENT_PHOTOS.head("tryons/client/look.png")).not.toBeNull();

    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set-fit', 'visit-first-fit', 'before', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
         VALUES ('p', 'set-fit', 'front', 'visits/visit-first-fit/before-front.jpg', 'image/jpeg', 1000, ?1, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
    await sweepNow();

    expect(await env.CLIENT_PHOTOS.head("tryons/client/look.png")).toBeNull();
    expect(await jobRow("client")).toMatchObject({ kept_look_key: null, copy_key: copyOf("client") });
    expect(await env.CLIENT_PHOTOS.head(copyOf("client"))).not.toBeNull();
    expect(await metered()).toBe(COPY.byteLength);
  });

  it("keeps today's rules for a try-on agreed to under the published notice, whoever made it", async () => {
    await tryOnWithCopy("published", { photo_consent_version: "photo-v1", copy_key: null });
    await booksAVisit();
    await lookDue("published");

    await sweepNow();

    expect(await jobRow("published")).toMatchObject({ state: "expired", kept_at: null, kept_look_key: null });
    expect(await env.RESULTS.head("results/published.png")).toBeNull();
  });
});

describe("an erasure", () => {
  it("deletes a client's kept copy and kept look", async () => {
    await tryOnWithCopy("client");
    await booksAVisit();
    await lookDue("client");
    await sweepNow();
    await env.DB.prepare("UPDATE appointments SET status = 'completed'").run();

    expect(await erasePerson(env, CLIENT, NOW, createLogger())).not.toBeNull();

    expect(await env.CLIENT_PHOTOS.head(copyOf("client"))).toBeNull();
    expect(await env.CLIENT_PHOTOS.head("tryons/client/look.png")).toBeNull();
    expect(await jobRow("client")).toMatchObject({ copy_key: null, kept_look_key: null });
  });

  it("deletes a copy still held with its look", async () => {
    await tryOnWithCopy("held");

    await erasePerson(env, CLIENT, NOW, createLogger());

    expect(await env.CLIENT_PHOTOS.head(copyOf("held"))).toBeNull();
  });
});

// The client's own try-ons in the app's Photos tab: a client who uploaded a photograph on the site sees it,
// and the look made from it, in the app (ADR 0082). Each is shown while the
// try-on's retention rule still holds it, and served only to its owner.
// Every name and number here is made up, and the "photographs" are synthetic.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../../src/http/context.ts";
import { openSession } from "../../../src/domain/sessions.ts";
import { loadJob } from "../../../src/domain/tryon.ts";
import { recordClaim, reserveJob } from "../../../src/domain/tryon-claims.ts";
import { signToken } from "../../../src/lib/signed-token.ts";
import { appFor, fakeDependencies, LOCAL_SETTINGS, markDatabase, NOW, request } from "../helpers.ts";
import { insertJob, insertPerson, syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";

const CLIENT = "person-client";
const MOBILE = "+919810000001";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

interface TryOnImage {
  url: string;
  kept_until: string | null;
}
interface TryOn {
  id: string;
  made_on: string;
  kept: boolean;
  photo: TryOnImage | null;
  look: TryOnImage | null;
}

let client: App;
let cookie: string;

async function signIn(personId: string): Promise<void> {
  cookie = `mm_app=${await openSession(env.DB, { kind: "client", subjectId: personId, deviceLabel: null, now: NOW })}`;
}

const get = (path: string, withCookie = true) =>
  request(client, path, { headers: withCookie ? { Cookie: cookie } : {} });

async function tryOns(): Promise<TryOn[]> {
  const response = await get("/api/photos");
  expect(response.status).toBe(200);
  return (await response.json<{ try_ons: TryOn[] }>()).try_ons;
}

/**
 * A look made from its own photograph, both still held: the photograph for an hour, the look for 14 days. Its claim
 * came with the number proved by a code, as every claim does.
 */
async function madeLook(id: string, createdAgoMs: number, columns: Record<string, string | number | null> = {}) {
  await insertJob({
    id,
    person_id: CLIENT,
    created_at: at(-createdAgoMs),
    uploaded_at: at(-createdAgoMs),
    state: "ready",
    result_key: `results/${id}.png`,
    expires_at: at(14 * DAY - createdAgoMs),
    number_proved_at: at(-createdAgoMs),
    ...columns,
  });
}

beforeEach(async () => {
  client = appFor("local", fakeDependencies(), {}, "client");
  await markDatabase();
  await insertPerson(CLIENT, MOBILE, "Rohit Malhotra");
  await insertPerson("person-other", "+919810000002", "Someone Else");
  await signIn(CLIENT);
});

describe("GET /api/photos's try-ons", () => {
  it("lists the client's own, newest first, each image while it is held and until when", async () => {
    await madeLook("job-today", 30 * MINUTE);
    await madeLook("job-earlier", 3 * DAY, { upload_deleted_at: at(-3 * DAY + 65 * MINUTE) });
    await insertJob({
      id: "job-rendering",
      person_id: CLIENT,
      created_at: at(-5 * MINUTE),
      uploaded_at: at(-5 * MINUTE),
      state: "rendering",
      number_proved_at: at(-5 * MINUTE),
    });
    await madeLook("job-someone-else", 10 * MINUTE, { person_id: "person-other" });
    await insertJob({ id: "job-unclaimed", created_at: at(-MINUTE), uploaded_at: at(-MINUTE), state: "ready" });

    const listed = await tryOns();
    expect(listed.map((tryOn) => tryOn.id)).toEqual(["job-rendering", "job-today", "job-earlier"]);
    expect(listed.map((tryOn) => tryOn.made_on)).toEqual(["2026-09-21", "2026-09-21", "2026-09-18"]);

    const [rendering, today, earlier] = listed;
    // Still being made: the photograph alone, deleted an hour after the look was asked for.
    expect(rendering?.look).toBeNull();
    expect(rendering?.photo?.kept_until).toBe(at(55 * MINUTE));
    // Both held: the photograph for the hour, the look until the day the site keeps it to.
    expect(today?.photo?.kept_until).toBe(at(30 * MINUTE));
    expect(today?.look?.kept_until).toBe(at(14 * DAY - 30 * MINUTE));
    // The photograph was deleted within the hour; the look is still held.
    expect(earlier?.photo).toBeNull();
    expect(earlier?.look?.kept_until).toBe(at(11 * DAY));

    for (const tryOn of listed) {
      for (const image of [tryOn.photo, tryOn.look]) {
        if (image === null) continue;
        expect(image.url).toMatch(/^\/api\/photos\/try-on\/(photo|look)\/[\w-]+\.\d+\.[\w-]+$/);
        // Never an R2 key: the link names nothing but a signed job.
        expect(image.url).not.toContain("results");
        expect(image.url).not.toContain("uploads");
      }
    }
  });

  it("leaves out a failed render, a look past its day, and an expired try-on", async () => {
    await insertJob({
      id: "job-failed",
      person_id: CLIENT,
      created_at: at(-10 * MINUTE),
      uploaded_at: at(-10 * MINUTE),
      state: "failed",
      failure_code: "render_failed",
    });
    // Past its day, and the sweeper has not come round yet.
    await madeLook("job-overdue", 15 * DAY, { upload_deleted_at: at(-15 * DAY + 65 * MINUTE) });
    await madeLook("job-expired", 20 * DAY, { state: "expired", upload_deleted_at: at(-20 * DAY + 65 * MINUTE) });

    expect(await tryOns()).toEqual([]);
  });

  it("drops the photograph and then the look as each is deleted, and everything once erased", async () => {
    await madeLook("job-today", 30 * MINUTE);
    await env.DB.prepare("UPDATE tryon_jobs SET upload_deleted_at = ?1").bind(NOW.toISOString()).run();
    expect((await tryOns()).map((tryOn) => [tryOn.photo, tryOn.look === null])).toEqual([[null, false]]);

    // An erasure deletes the look and marks the photograph gone (src/domain/erasure.ts).
    await env.DB.prepare("UPDATE tryon_jobs SET result_key = NULL").run();
    expect(await tryOns()).toEqual([]);
  });

  it("shows a photograph once, beside its first look", async () => {
    await madeLook("job-first", 20 * MINUTE, { upload_key: "uploads/job-first" });
    await madeLook("job-second", 10 * MINUTE, { upload_key: "uploads/job-first", parent_job_id: "job-first" });

    const [second, first] = await tryOns();
    expect(second?.photo).toBeNull();
    expect(second?.look).not.toBeNull();
    // The photograph is kept for an hour after the last look asked of it.
    expect(first?.photo?.kept_until).toBe(at(50 * MINUTE));
    expect(first?.look).not.toBeNull();
  });

  it("is the try-on the site's gate claimed with the client's own number", async () => {
    await insertJob({
      id: "job-claimed",
      created_at: at(-2 * MINUTE),
      uploaded_at: at(-2 * MINUTE),
      state: "ready",
      stage: "crown",
      result_key: "results/job-claimed.png",
      expires_at: at(14 * DAY),
    });
    const job = await loadJob(env.DB, "job-claimed");
    if (job === null) throw new Error("the job was not written");
    expect(await reserveJob(env.DB, job.id, NOW)).toBe(true);
    await recordClaim(env.DB, {
      job,
      mobileE164: MOBILE,
      name: "Rohit Malhotra",
      testRecord: false,
      stage: "crown",
      gateNotice: "gate-v1",
      attribution: {},
      ipHash: "ip-hash",
      requestId: "request",
      now: NOW,
    });

    expect((await tryOns()).map((tryOn) => tryOn.id)).toEqual(["job-claimed"]);
  });

  // Anyone could type the client's number at the gate before it asked for a code, so such a try-on may hold a
  // stranger's photograph.
  it("leaves out a try-on whose claim no code proved, and opens none of its images", async () => {
    await madeLook("job-unproved", 30 * MINUTE, { number_proved_at: null });
    await env.RESULTS.put("results/job-unproved.png", syntheticPng(600, 800), {
      httpMetadata: { contentType: "image/png" },
    });
    await madeLook("job-proved", 20 * MINUTE);

    expect((await tryOns()).map((tryOn) => tryOn.id)).toEqual(["job-proved"]);
    const expiresAt = new Date(NOW.getTime() + 10 * MINUTE);
    const token = await signToken(LOCAL_SETTINGS.tryon.linkSigningKey, "tryon_look", "job-unproved", expiresAt);
    expect((await get(`/api/photos/try-on/look/${token}`)).status).toBe(404);
  });
});

describe("GET /api/photos/try-on/{image}/{token}", () => {
  async function stored(): Promise<TryOn> {
    await madeLook("job-today", 30 * MINUTE);
    await env.UPLOADS.put("uploads/job-today", syntheticJpeg(600, 800), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await env.RESULTS.put("results/job-today.png", syntheticPng(600, 800), {
      httpMetadata: { contentType: "image/png" },
    });
    const [tryOn] = await tryOns();
    if (tryOn === undefined) throw new Error("the try-on was not listed");
    return tryOn;
  }

  it("serves the photograph and the look to the client whose try-on it is", async () => {
    const tryOn = await stored();

    const photo = await get(tryOn.photo?.url ?? "");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    expect(photo.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(photo.headers.get("Content-Disposition")).toBe('inline; filename="mane-man-2026-09-21-try-on-photo.jpg"');
    expect(new Uint8Array(await photo.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));

    const look = await get(tryOn.look?.url ?? "");
    expect(look.status).toBe(200);
    expect(look.headers.get("Content-Type")).toBe("image/png");
    expect(look.headers.get("Content-Disposition")).toBe('inline; filename="mane-man-2026-09-21-try-on-look.png"');
  });

  it("needs the session, and opens nothing of another client's", async () => {
    const tryOn = await stored();
    const url = tryOn.look?.url ?? "";
    expect((await get(url, false)).status).toBe(401);

    await signIn("person-other");
    expect((await get(url)).status).toBe(404);
  });

  it("will not open a look with a photograph's link, nor a link past its 15 minutes", async () => {
    const tryOn = await stored();
    const photoUrl = tryOn.photo?.url ?? "";
    expect((await get(photoUrl.replace("/try-on/photo/", "/try-on/look/"))).status).toBe(404);

    const later = appFor("local", fakeDependencies({ now: () => new Date(NOW.getTime() + 16 * MINUTE) }), {}, "client");
    expect((await request(later, photoUrl, { headers: { Cookie: cookie } })).status).toBe(404);
  });

  // The site's result links share a day's ceiling; a client's own looks are counted per client instead.
  it("opens a client's images past the site's result-read ceiling, up to the client's own day's count", async () => {
    const tryOn = await stored();
    client = appFor(
      "local",
      fakeDependencies(),
      { tryon: { ...LOCAL_SETTINGS.tryon, resultReadDailyCeiling: 0 } },
      "client",
    );
    expect((await get(tryOn.photo?.url ?? "")).status).toBe(200);
    expect((await get(tryOn.look?.url ?? "")).status).toBe(200);

    await env.DB.prepare("UPDATE counters SET count = 200 WHERE scope = 'tryon_image:person'").run();
    const refused = await get(tryOn.look?.url ?? "");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("opens a photograph no longer once it is deleted, nor a look past its day", async () => {
    const tryOn = await stored();
    await env.DB.prepare("UPDATE tryon_jobs SET upload_deleted_at = ?1").bind(NOW.toISOString()).run();
    expect((await get(tryOn.photo?.url ?? "")).status).toBe(404);
    expect((await get(tryOn.look?.url ?? "")).status).toBe(200);

    await env.DB.prepare("UPDATE tryon_jobs SET expires_at = ?1").bind(at(-MINUTE)).run();
    expect((await get(tryOn.look?.url ?? "")).status).toBe(404);
  });
});

// "Show the before photo always, keep the generated image till the photos
// for first fit are taken" (docs/decisions/0084-a-clients-try-on-is-kept.md).
describe("a client's try-on, kept", () => {
  const copyOf = (id: string) => `tryons/${id}/before.jpg`;

  /** A look made under the notice that keeps a client's try-on, with the small copy the site sent. */
  async function withCopy(id: string, createdAgoMs: number, columns: Record<string, string | number | null> = {}) {
    await madeLook(id, createdAgoMs, { photo_consent_version: "photo-v2", copy_key: copyOf(id), ...columns });
    await env.CLIENT_PHOTOS.put(copyOf(id), syntheticJpeg(900, 1200), { httpMetadata: { contentType: "image/jpeg" } });
  }

  async function booksAVisit(type = "consultation", id = `visit-${type}`): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, fsm_status,
         fsm_modified_at, synced_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 'scheduled', 'Scheduled', ?5, ?5)`,
    )
      .bind(id, `fsm-${id}`, CLIENT, type, at(3 * DAY))
      .run();
  }

  async function firstFitPhotographed(): Promise<void> {
    await booksAVisit("first_fit", "visit-first-fit");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('set', 'visit-first-fit', 'before', ?1)",
      ).bind(NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
         VALUES ('p', 'set', 'front', 'visits/visit-first-fit/front.jpg', 'image/jpeg', 1000, ?1, ?1)`,
      ).bind(NOW.toISOString()),
    ]);
  }

  it("shows the small copy as the photograph, held as long as the look, before the client books", async () => {
    await withCopy("job", 2 * 60 * MINUTE, { upload_deleted_at: at(-MINUTE) });

    const [tryOn] = await tryOns();
    expect(tryOn?.kept).toBe(false);
    expect(tryOn?.photo?.kept_until).toBe(at(14 * DAY - 120 * MINUTE));
    expect(tryOn?.look?.kept_until).toBe(at(14 * DAY - 120 * MINUTE));
  });

  it("keeps the photograph and, until the first fit is photographed, the look, once the client has booked", async () => {
    await withCopy("job", 2 * 60 * MINUTE, { upload_deleted_at: at(-MINUTE) });
    await booksAVisit();

    const [tryOn] = await tryOns();
    expect(tryOn).toMatchObject({ id: "job", kept: true, photo: { kept_until: null }, look: { kept_until: null } });
  });

  it("keeps one try-on a client, the oldest; the others keep their days", async () => {
    await withCopy("older", 3 * DAY);
    await withCopy("newer", 60 * MINUTE);
    await booksAVisit();

    const listed = await tryOns();
    expect(listed.map((tryOn) => [tryOn.id, tryOn.kept])).toEqual([
      ["newer", false],
      ["older", true],
    ]);
  });

  it("shows the before photo alone after the first fit is photographed, and still on every visit after", async () => {
    await withCopy("job", 20 * DAY, {
      state: "expired",
      upload_deleted_at: at(-20 * DAY),
      kept_at: at(-6 * DAY),
      kept_look_key: null,
    });
    await firstFitPhotographed();

    const visitPhotos = async () => {
      const [tryOn] = await tryOns();
      expect(tryOn).toMatchObject({ id: "job", kept: true, photo: { kept_until: null }, look: null });
      const photo = await get(tryOn?.photo?.url ?? "");
      expect(photo.status).toBe(200);
      expect(photo.headers.get("Content-Type")).toBe("image/jpeg");
    };
    await visitPhotos();
    await visitPhotos();
  });

  it("serves a kept look from where it is kept, past the day the site keeps looks to", async () => {
    await withCopy("job", 20 * DAY, {
      state: "expired",
      upload_deleted_at: at(-20 * DAY),
      kept_at: at(-6 * DAY),
      kept_look_key: "tryons/job/look.png",
    });
    await env.CLIENT_PHOTOS.put("tryons/job/look.png", syntheticPng(900, 1200), {
      httpMetadata: { contentType: "image/png" },
    });

    const [tryOn] = await tryOns();
    expect(tryOn?.look?.kept_until).toBeNull();
    const look = await get(tryOn?.look?.url ?? "");
    expect(look.status).toBe(200);
    expect(look.headers.get("Content-Type")).toBe("image/png");
  });

  it("gives the look its day for a client whose first fit is photographed already", async () => {
    await withCopy("job", 2 * 60 * MINUTE);
    await firstFitPhotographed();

    const [tryOn] = await tryOns();
    expect(tryOn).toMatchObject({ kept: true, photo: { kept_until: null } });
    expect(tryOn?.look?.kept_until).toBe(at(14 * DAY - 120 * MINUTE));
  });

  it("keeps today's rules for a try-on agreed to under the published notice, booked or not", async () => {
    await madeLook("job", 30 * MINUTE);
    await booksAVisit();

    const [tryOn] = await tryOns();
    expect(tryOn?.kept).toBe(false);
    expect(tryOn?.photo?.kept_until).toBe(at(30 * MINUTE));
    expect(tryOn?.look?.kept_until).toBe(at(14 * DAY - 30 * MINUTE));
  });
});

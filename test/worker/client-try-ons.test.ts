// The client's own try-ons in the app's Photos tab: the owner's ruling of 27
// September 2026 that a client who uploaded a photograph on the site sees it,
// and the look made from it, in the app (ADR 0082). Each is shown while the
// try-on's retention rule still holds it, and served only to its owner.
// Every name and number here is made up, and the "photographs" are synthetic.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { openSession } from "../../src/domain/sessions.ts";
import { loadJob } from "../../src/domain/tryon.ts";
import { recordClaim, reserveJob } from "../../src/domain/tryon-claims.ts";
import { appFor, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";
import { insertJob, insertPerson, syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const CLIENT = "person-client";
const MOBILE = "+919810000001";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

interface TryOnImage {
  url: string;
  kept_until: string;
}
interface TryOn {
  id: string;
  made_on: string;
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

/** A look made from its own photograph, both still held: the photograph for an hour, the look for 14 days. */
async function madeLook(id: string, createdAgoMs: number, columns: Record<string, string | number | null> = {}) {
  await insertJob({
    id,
    person_id: CLIENT,
    created_at: at(-createdAgoMs),
    uploaded_at: at(-createdAgoMs),
    state: "ready",
    result_key: `results/${id}.png`,
    expires_at: at(14 * DAY - createdAgoMs),
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
      attribution: {},
      ipHash: "ip-hash",
      requestId: "request",
      now: NOW,
    });

    expect((await tryOns()).map((tryOn) => tryOn.id)).toEqual(["job-claimed"]);
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

  it("opens a photograph no longer once it is deleted, nor a look past its day", async () => {
    const tryOn = await stored();
    await env.DB.prepare("UPDATE tryon_jobs SET upload_deleted_at = ?1").bind(NOW.toISOString()).run();
    expect((await get(tryOn.photo?.url ?? "")).status).toBe(404);
    expect((await get(tryOn.look?.url ?? "")).status).toBe(200);

    await env.DB.prepare("UPDATE tryon_jobs SET expires_at = ?1").bind(at(-MINUTE)).run();
    expect((await get(tryOn.look?.url ?? "")).status).toBe(404);
  });
});

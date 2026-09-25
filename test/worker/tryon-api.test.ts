import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/config/settings.ts";
import { MAX_UPLOAD_BYTES } from "../../src/config/tryon.ts";
import {
  LOCAL_SETTINGS,
  NOW,
  TURNSTILE_URL,
  appFor,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  fakeQueue,
  json,
  markDatabase,
  request,
  type TestDependencies,
} from "./helpers.ts";
import { insertPerson, syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

type TryonSettingsOverride = Partial<Settings["tryon"]>;

/** The try-on API as one visitor's browser sees it: it keeps its cookies (mm_look, mm_tryon) between calls. */
function visitor(
  options: { tryon?: TryonSettingsOverride; messaging?: Partial<Settings["messaging"]>; deps?: TestDependencies } = {},
) {
  const deps = options.deps ?? fakeDependencies();
  const app = appFor("local", deps, {
    tryon: { ...LOCAL_SETTINGS.tryon, ...options.tryon },
    messaging: { ...LOCAL_SETTINGS.messaging, ...options.messaging },
  });
  const queues = { RENDER_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() };
  const cookies = new Map<string, string>();

  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) headers.set("Cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await request(app, path, { ...init, headers }, queues);
    for (const set of response.headers.getSetCookie()) {
      const [name = "", value = ""] = (set.split(";")[0] ?? "").split("=");
      cookies.set(name, value);
    }
    return response;
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  return {
    deps,
    queues,
    call,
    post,
    dropCookies: () => {
      cookies.clear();
    },
    cookie: (name: string) => cookies.get(name) ?? "",
    useCookie: (name: string, value: string) => {
      cookies.set(name, value);
    },
    uploadLink: (body: Record<string, unknown> = {}) =>
      post("/api/tryon/upload-url", { photo_consent: true, notice_version: "photo-v1", turnstile_token: "t", ...body }),
    put: (path: string, bytes: Uint8Array, contentType = "image/jpeg") =>
      call(path, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes }),
    async uploaded(bytes: Uint8Array = syntheticJpeg(800, 800)): Promise<string> {
      const link = await (await this.uploadLink()).json<{ job_id: string; upload_url: string }>();
      expect((await this.put(link.upload_url, bytes)).status).toBe(204);
      return link.job_id;
    },
    generate: (jobId: string, body: Record<string, unknown> = {}) =>
      post("/api/tryon/generate", {
        job_id: jobId,
        stage: "crown",
        preset: "full-natural-short",
        hair_color: "black",
        ...body,
      }),
    claim: (jobId: string, mobile = "98100 00001", headers: Record<string, string> = {}) =>
      post("/api/tryon/claim", { job_id: jobId, name: "Arjun Mehta", mobile }, headers),
  };
}

function jobRow(id: string) {
  return env.DB.prepare("SELECT * FROM tryon_jobs WHERE id = ?").bind(id).first();
}

async function setState(id: string, state: string, extra = ""): Promise<void> {
  await env.DB.prepare(`UPDATE tryon_jobs SET state = ?${extra} WHERE id = ?`).bind(state, id).run();
}

async function makeReady(id: string): Promise<void> {
  await env.RESULTS.put(`results/${id}.png`, syntheticPng(512, 512), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE tryon_jobs SET state = 'ready', result_key = ? WHERE id = ?")
    .bind(`results/${id}.png`, id)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("POST /api/tryon/upload-url", () => {
  it("records the photo consent on a new job and returns a five-minute upload link", async () => {
    const response = await visitor().uploadLink();
    expect(response.status).toBe(201);
    const body = await response.json<{ job_id: string; upload_url: string; expires_at: string }>();
    expect(body.upload_url).toMatch(new RegExp(`^/api/tryon/upload/${body.job_id}\\?token=`));
    expect(body.expires_at).toBe(new Date(NOW.getTime() + 5 * 60_000).toISOString());

    expect(await jobRow(body.job_id)).toMatchObject({
      state: "awaiting_upload",
      upload_key: `uploads/${body.job_id}`,
      photo_consent_version: "photo-v1",
      photo_consent_at: NOW.toISOString(),
      session_id: null,
      person_id: null,
    });
  });

  it("ties a new photo to the session of a visitor who passed the gate, so its result needs no second gate", async () => {
    const browser = visitor();
    const failed = await browser.uploaded();
    await browser.generate(failed);
    await browser.claim(failed);
    await setState(failed, "failed");
    const session = await env.DB.prepare("SELECT id, person_id FROM tryon_sessions").first<{
      id: string;
      person_id: string;
    }>();

    const again = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();
    expect(await jobRow(again.job_id)).toMatchObject({ session_id: session?.id, person_id: session?.person_id });

    expect((await browser.put(again.upload_url, syntheticJpeg(800, 800))).status).toBe(204);
    await browser.generate(again.job_id);
    await makeReady(again.job_id);
    const claimant = visitor();
    claimant.useCookie("mm_tryon", browser.cookie("mm_tryon"));
    expect((await claimant.call(`/api/tryon/result/${again.job_id}`)).status).toBe(200);
  });

  it("refuses consent that is not literally true, and a notice that is not the photo notice", async () => {
    const browser = visitor();
    for (const body of [{ photo_consent: false }, { notice_version: "booking-v1" }, { extra: 1 }]) {
      expect((await browser.uploadLink(body)).status).toBe(400);
    }
  });

  it("refuses a failed Turnstile check", async () => {
    const deps = fakeDependencies({ fetch: fakeFetch({ [TURNSTILE_URL]: () => json({ success: false }) }).fetch });
    expect((await visitor({ deps }).uploadLink()).status).toBe(403);
  });

  it("limits uploads per address per hour", async () => {
    const browser = visitor({ tryon: { uploadIpHourlyLimit: 2 } });
    expect((await browser.uploadLink()).status).toBe(201);
    expect((await browser.uploadLink()).status).toBe(201);
    expect((await browser.uploadLink()).status).toBe(429);
  });

  it("answers busy once the daily upload ceiling is reached, and alerts once", async () => {
    const browser = visitor({ tryon: { uploadDailyCeiling: 1 } });
    expect((await browser.uploadLink()).status).toBe(201);
    const refused = await browser.uploadLink();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "busy" } });
    await browser.uploadLink();
    expect(browser.deps.alerts).toEqual([expect.stringContaining("upload ceiling (1)") as string]);
  });
});

describe("PUT /api/tryon/upload/:job_id", () => {
  it("stores the photo once, labelled by its bytes", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();

    expect((await browser.put(link.upload_url, syntheticPng(600, 800), "application/octet-stream")).status).toBe(204);
    expect((await env.UPLOADS.head(`uploads/${link.job_id}`))?.httpMetadata?.contentType).toBe("image/png");
    expect((await jobRow(link.job_id))?.uploaded_at).toBe(NOW.toISOString());

    const again = await browser.put(link.upload_url, syntheticPng(600, 800));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "upload_already_received" } });
  });

  it("refuses a link that is forged, for another job, or expired", async () => {
    const browser = visitor();
    const first = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();
    const second = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();
    const token = new URL(first.upload_url, "https://x").searchParams.get("token") ?? "";

    expect(
      (await browser.put(`/api/tryon/upload/${second.job_id}?token=${token}`, syntheticJpeg(800, 800))).status,
    ).toBe(404);
    expect(
      (await browser.put(`/api/tryon/upload/${first.job_id}?token=${token}x`, syntheticJpeg(800, 800))).status,
    ).toBe(404);

    const later = fakeDependencies({ now: () => new Date(NOW.getTime() + 6 * 60_000) });
    expect((await visitor({ deps: later }).put(first.upload_url, syntheticJpeg(800, 800))).status).toBe(404);
  });

  it.each([
    ["not an image", new TextEncoder().encode("<html>")],
    ["too small", syntheticJpeg(150, 150)],
    ["too large", syntheticJpeg(5000, 3000)],
  ])("refuses a photo that is %s", async (_label, bytes) => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ upload_url: string }>();
    const response = await browser.put(link.upload_url, bytes);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "photo_invalid_file" } });
  });

  it("refuses a body over 5 MB before storing anything", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(syntheticJpeg(800, 800));
    expect((await browser.put(link.upload_url, big)).status).toBe(422);
    expect(await env.UPLOADS.head(`uploads/${link.job_id}`)).toBeNull();
  });
});

describe("POST /api/tryon/generate and GET /api/tryon/status", () => {
  it("queues the first look, records the render choice and sends it to the render queue", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();

    const response = await browser.generate(jobId, {
      stage: "receding",
      preset: "light-receded-cropped",
      hair_color: "grey",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job_id: jobId, state: "queued" });
    expect(await jobRow(jobId)).toMatchObject({
      state: "queued",
      stage: "receding",
      preset: "light-receded-cropped",
      hair_color: "grey",
      endpoint: "pro",
      provider_color: "grey",
      color_route: "as_detected",
    });
    expect(browser.queues.RENDER_QUEUE.sent).toEqual([{ job_id: jobId, request_id: expect.any(String) as string }]);

    const status = await browser.call(`/api/tryon/status/${jobId}`);
    expect(await status.json()).toEqual({ job_id: jobId, state: "queued" });
  });

  it("routes an unknown colour to Premium with color=original, and records why", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId, { hair_color: "unknown" });
    expect(await jobRow(jobId)).toMatchObject({
      endpoint: "premium",
      provider_color: "original",
      color_route: "premium_original",
    });
  });

  it("returns the same job for the same request, without a second render", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    const again = await browser.generate(jobId);
    expect(await again.json()).toEqual({ job_id: jobId, state: "queued" });
    expect(browser.queues.RENDER_QUEUE.sent).toHaveLength(1);
  });

  it("needs the upload first, and refuses a different look for the same photo", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string }>();
    expect(await (await browser.generate(link.job_id)).json()).toMatchObject({ error: { code: "upload_missing" } });

    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    const other = await browser.generate(jobId, { preset: "light-natural-short" });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "look_limit_reached" } });
  });

  it("trips the render ceiling at 3: the fourth answers 503 busy, fails its job and alerts once", async () => {
    const browser = visitor({ tryon: { renderDailyCeiling: 3, uploadIpHourlyLimit: 10, generateIpHourlyLimit: 10 } });
    const jobs = [
      await browser.uploaded(),
      await browser.uploaded(),
      await browser.uploaded(),
      await browser.uploaded(),
    ];

    for (const jobId of jobs.slice(0, 3)) expect((await browser.generate(jobId)).status).toBe(202);
    const fourth = await browser.generate(jobs[3] ?? "");
    expect(fourth.status).toBe(503);
    expect(await fourth.json()).toMatchObject({ error: { code: "busy" } });

    const status = await browser.call(`/api/tryon/status/${jobs[3] ?? ""}`);
    expect(await status.json()).toEqual({ job_id: jobs[3], state: "failed", failure_code: "busy" });
    expect(browser.deps.alerts).toEqual([expect.stringContaining("render ceiling (3)") as string]);
  });

  it("limits renders per address per hour, and knows no unknown job", async () => {
    const browser = visitor({ tryon: { generateIpHourlyLimit: 1 } });
    expect((await browser.generate(crypto.randomUUID())).status).toBe(404);
    expect((await browser.generate(crypto.randomUUID())).status).toBe(429);
    expect((await browser.call(`/api/tryon/status/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe("POST /api/tryon/claim", () => {
  it("captures the lead while the render is still running, and opens a session", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId, { stage: "advanced" });
    await setState(jobId, "rendering");

    const response = await browser.claim(jobId);
    expect(response.status).toBe(201);
    const { lead_id: leadId, whatsapp_copy: whatsappCopy } = await response.json<{
      lead_id: string;
      whatsapp_copy: boolean;
    }>();
    expect(whatsappCopy).toBe(true);
    expect(response.headers.get("Set-Cookie")).toMatch(
      /^mm_tryon=[0-9a-f-]{36}; Max-Age=1800; Path=\/api\/tryon; HttpOnly; Secure; SameSite=Strict$/,
    );

    const lead = await env.DB.prepare("SELECT source, city, first_choice_window, loss_extent FROM leads WHERE id = ?")
      .bind(leadId)
      .first();
    expect(lead).toEqual({ source: "tryon", city: null, first_choice_window: null, loss_extent: "advanced" });
    const person = await env.DB.prepare("SELECT mobile_e164, contactable FROM people").first();
    expect(person).toEqual({ mobile_e164: "+919810000001", contactable: 0 }); // a try-on alone is not contact consent
    const consents = await env.DB.prepare(
      "SELECT purpose, notice_version, created_at FROM consents ORDER BY purpose",
    ).all();
    expect(consents.results).toEqual([
      { purpose: "result_delivery", notice_version: "gate-v1", created_at: NOW.toISOString() },
      { purpose: "tryon_photo", notice_version: "photo-v1", created_at: NOW.toISOString() },
    ]);
    expect(await jobRow(jobId)).toMatchObject({ lead_id: leadId, claimed_at: NOW.toISOString() });
    const message = await env.DB.prepare("SELECT state, subject_id FROM outbound_messages").first();
    expect(message).toEqual({ state: "waiting", subject_id: jobId });
    expect(browser.queues.CRM_QUEUE.sent).toEqual([{ lead_id: leadId, request_id: expect.any(String) as string }]);
    expect(browser.queues.MESSAGE_QUEUE.sent).toEqual([]);
  });

  it("queues the message at once when the result is already ready", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await makeReady(jobId);

    await browser.claim(jobId);

    const message = await env.DB.prepare("SELECT id, state FROM outbound_messages").first<{
      id: string;
      state: string;
    }>();
    expect(message?.state).toBe("queued");
    expect(browser.queues.MESSAGE_QUEUE.sent).toEqual([
      { message_id: message?.id, request_id: expect.any(String) as string },
    ]);
  });

  it("promises no WhatsApp copy while messaging is off", async () => {
    const browser = visitor({ messaging: { enabled: false } });
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    expect(await (await browser.claim(jobId)).json()).toMatchObject({ whatsapp_copy: false });
  });

  it("promises a WhatsApp copy only to a number on the allowlist, where there is one", async () => {
    const browser = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const skipped = await browser.uploaded();
    await browser.generate(skipped);
    expect(await (await browser.claim(skipped, "98100 00001")).json()).toMatchObject({ whatsapp_copy: false });

    const other = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const sent = await other.uploaded();
    await other.generate(sent);
    expect(await (await other.claim(sent, "98100 00002")).json()).toMatchObject({ whatsapp_copy: true });
  });

  it("keeps a person who booked before contactable", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.prepare("UPDATE people SET contactable = 1").run();
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);
    expect(await env.DB.prepare("SELECT contactable FROM people").first()).toEqual({ contactable: 1 });
  });

  it("replays an idempotent claim with the same lead and the cookie again", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    const first = await (await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" })).json();
    browser.dropCookies();

    const replay = await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" });
    expect(await replay.json()).toEqual(first);
    expect(replay.headers.get("Set-Cookie")).toMatch(/^mm_tryon=/);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first()).toEqual({ n: 1 });
  });

  it("lets the same number claim again for a fresh session, and refuses another number", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    const first = await (await browser.claim(jobId)).json<{ lead_id: string }>();

    const again = await browser.claim(jobId);
    expect(await again.json()).toMatchObject({ lead_id: first.lead_id });
    const stranger = await visitor().claim(jobId, "98100 00002");
    expect(stranger.status).toBe(409);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first()).toEqual({ n: 1 });
  });

  it("refuses a job with no render started, or one that failed", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    expect(await (await browser.claim(jobId)).json()).toMatchObject({ error: { code: "job_not_claimable" } });
    await browser.generate(jobId);
    await setState(jobId, "failed");
    expect((await browser.claim(jobId)).status).toBe(409);
    expect((await browser.claim(crypto.randomUUID())).status).toBe(404);
    expect((await browser.claim(jobId, "12345")).status).toBe(400);
  });

  it("limits claims per number per day", async () => {
    const browser = visitor({ tryon: { claimMobileDailyLimit: 1 } });
    const first = await browser.uploaded();
    const second = await browser.uploaded();
    await browser.generate(first);
    await browser.generate(second);
    expect((await browser.claim(first)).status).toBe(201);
    expect((await browser.claim(second)).status).toBe(429);
  });
});

describe("results, and one look per visitor", () => {
  it("shows the result to the session that claimed it", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);
    const claimant = visitor();
    claimant.useCookie("mm_tryon", browser.cookie("mm_tryon"));
    const running = await claimant.call(`/api/tryon/result/${jobId}`);
    expect(running.status).toBe(202);
    expect(await running.json()).toEqual({ state: "queued" });

    await makeReady(jobId);
    const ready = await claimant.call(`/api/tryon/result/${jobId}`);
    expect(ready.status).toBe(200);
    const { url } = await ready.json<{ url: string }>();
    const image = await claimant.call(url);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer()).slice(0, 4)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));

    const stranger = visitor();
    await insertPerson("q", "+919810000009");
    expect((await stranger.call(`/api/tryon/result/${jobId}`)).status).toBe(403);
  });

  it("shows the result to the browser that made the look, with no number given", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    const running = await browser.call(`/api/tryon/result/${jobId}`);
    expect(running.status).toBe(202);
    await makeReady(jobId);
    expect((await browser.call(`/api/tryon/result/${jobId}`)).status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM leads").first()).toEqual({ n: 0 });
  });

  it("refuses a look cookie that is made up, stale, or names another job", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);

    const forger = visitor();
    forger.useCookie("mm_look", jobId); // the bare job ID, as the cookie held before it was signed
    expect((await forger.call(`/api/tryon/result/${jobId}`)).status).toBe(403);
    forger.useCookie("mm_look", `${browser.cookie("mm_look")}x`);
    expect((await forger.call(`/api/tryon/result/${jobId}`)).status).toBe(403);

    const other = await visitor().uploaded();
    expect((await browser.call(`/api/tryon/result/${other}`)).status).toBe(403);

    const later = visitor({ deps: fakeDependencies({ now: () => new Date(NOW.getTime() + 31 * 24 * 3_600_000) }) });
    later.useCookie("mm_look", browser.cookie("mm_look"));
    expect((await later.call(`/api/tryon/result/${jobId}`)).status).toBe(403);
  });

  it("tells a browser which look it has, until the look's result is gone", async () => {
    const browser = visitor();
    expect((await browser.call("/api/tryon/look")).status).toBe(404);
    const jobId = await browser.uploaded();
    await browser.generate(jobId, { stage: "receding", preset: "light-natural-short" });

    const look = await browser.call("/api/tryon/look");
    expect(look.status).toBe(200);
    expect(await look.json()).toEqual({
      job_id: jobId,
      state: "queued",
      stage: "receding",
      preset: "light-natural-short",
    });
    await setState(jobId, "expired");
    expect((await browser.call("/api/tryon/look")).status).toBe(404);
  });

  it("reports a failed render with its failure code", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);
    await setState(jobId, "failed", ", failure_code = 'photo_unreadable'");
    const response = await browser.call(`/api/tryon/result/${jobId}`);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ state: "failed", failure_code: "photo_unreadable" });
  });

  it("gives one look per visitor: no second look, even after the gate", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);

    const look = await browser.generate(jobId, { preset: "medium-receded-medium" });
    expect(look.status).toBe(403);
    expect(await look.json()).toMatchObject({ error: { code: "look_limit_reached" } });
    // The same look asked for again is the job that already exists.
    expect(await (await browser.generate(jobId)).json()).toMatchObject({ job_id: jobId });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_jobs").first()).toEqual({ n: 1 });
  });

  it("refuses a second photo from a browser that already has its look", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const queued = await browser.generate(jobId);
    expect(queued.headers.get("Set-Cookie")).toMatch(
      /^mm_look=[\w-]+\.\d+\.[\w-]+; Max-Age=2592000; Path=\/api\/tryon; HttpOnly; Secure; SameSite=Strict$/,
    );

    const second = await browser.uploadLink();
    expect(second.status).toBe(403);
    expect(await second.json()).toMatchObject({ error: { code: "look_limit_reached" } });
  });

  it("lets a browser try another photo when its render failed", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await setState(jobId, "failed", ", failure_code = 'photo_unreadable'");

    expect((await browser.uploadLink()).status).toBe(201);
  });
});

describe("GET /api/result/:token", () => {
  it("refuses an invalid link, and answers busy past the daily read ceiling", async () => {
    const browser = visitor({ tryon: { resultReadDailyCeiling: 1 } });
    expect((await browser.call("/api/result/not-a-token")).status).toBe(404);

    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);
    await makeReady(jobId);
    const { url } = await (await browser.call(`/api/tryon/result/${jobId}`)).json<{ url: string }>();
    expect((await browser.call(url)).status).toBe(200);
    expect((await browser.call(url)).status).toBe(503);
    expect(browser.deps.alerts).toEqual([expect.stringContaining("result_read ceiling (1)") as string]);
  });

  it("answers 404 once the result has been deleted", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    await browser.generate(jobId);
    await browser.claim(jobId);
    await makeReady(jobId);
    const { url } = await (await browser.call(`/api/tryon/result/${jobId}`)).json<{ url: string }>();
    await env.RESULTS.delete(`results/${jobId}.png`);
    expect((await browser.call(url)).status).toBe(404);
  });
});

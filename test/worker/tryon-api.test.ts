import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../../src/config/settings.ts";
import { MAX_UPLOAD_BYTES, RESULT_LINK_MESSAGE_TTL_MS } from "../../src/config/tryon.ts";
import { signToken } from "../../src/lib/signed-token.ts";
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

/** The try-on API as one visitor's browser sees it: it keeps its cookie (mm_look) between calls. */
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
    cookie: (name: string) => cookies.get(name) ?? "",
    useCookie: (name: string, value: string) => {
      cookies.set(name, value);
    },
    uploadLink: (body: Record<string, unknown> = {}) =>
      post("/api/tryon/upload-url", { photo_consent: true, notice_version: "photo-v3", turnstile_token: "t", ...body }),
    put: (path: string, bytes: Uint8Array, contentType = "image/jpeg") =>
      call(path, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes }),
    async uploaded(bytes: Uint8Array = syntheticJpeg(800, 800)): Promise<string> {
      const link = await (await this.uploadLink()).json<{ job_id: string; upload_url: string }>();
      expect((await this.put(link.upload_url, bytes)).status).toBe(204);
      return link.job_id;
    },
    claim: (jobId: string, mobile = "98100 00001", headers: Record<string, string> = {}, body = {}) =>
      post("/api/tryon/claim", { job_id: jobId, name: "Arjun Mehta", mobile, stage: "crown", ...body }, headers),
    /** Uploaded, and claimed at the gate: ready for its render. */
    async claimed(mobile = "98100 00001"): Promise<string> {
      const jobId = await this.uploaded();
      expect((await this.claim(jobId, mobile)).status).toBe(201);
      return jobId;
    },
    generate: (jobId: string, body: Record<string, unknown> = {}) =>
      post("/api/tryon/generate", {
        job_id: jobId,
        stage: "crown",
        preset: "full-natural-short",
        hair_color: "black",
        ...body,
      }),
  };
}

function jobRow(id: string) {
  return env.DB.prepare("SELECT * FROM tryon_jobs WHERE id = ?").bind(id).first();
}

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function setState(id: string, state: string, extra = ""): Promise<void> {
  await env.DB.prepare(`UPDATE tryon_jobs SET state = ?${extra} WHERE id = ?`).bind(state, id).run();
}

async function makeReady(id: string): Promise<string> {
  const key = `results/${id}.png`;
  await env.RESULTS.put(key, syntheticPng(512, 512), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE tryon_jobs SET state = 'ready', result_key = ? WHERE id = ?").bind(key, id).run();
  return key;
}

/** The link a WhatsApp message carries to the look, as the messaging queue mints it when it sends. */
async function messageLink(resultKey: string): Promise<string> {
  const expiresAt = new Date(NOW.getTime() + RESULT_LINK_MESSAGE_TTL_MS);
  return `/api/result/${await signToken(LOCAL_SETTINGS.tryon.linkSigningKey, "result", resultKey, expiresAt)}`;
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
      photo_consent_version: "photo-v3",
      photo_consent_at: NOW.toISOString(),
      session_id: null,
      person_id: null,
    });
  });

  // ADR 0104: every photo notice before v3 promised the look on screen, which the site no longer shows.
  it("refuses consent that is not literally true, and any notice but the current photo notice", async () => {
    const browser = visitor();
    for (const body of [
      { photo_consent: false },
      { notice_version: "booking-v1" },
      { notice_version: "photo-v1" },
      { notice_version: "photo-v2" },
      { extra: 1 },
    ]) {
      expect((await browser.uploadLink(body)).status).toBe(400);
    }
  });

  // ADR 0104: the look goes to WhatsApp only, so with WhatsApp off the try-on does not start.
  it("refuses while WhatsApp cannot send the look, before anything is stored or counted", async () => {
    const refused = await visitor({ messaging: { enabled: false } }).uploadLink();
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "whatsapp_unavailable" } });
    expect(await count("tryon_jobs")).toBe(0);
    expect(await count("counters")).toBe(0);
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

describe("POST /api/tryon/claim, before the look is made", () => {
  it("captures the lead once the photograph is uploaded, before any render, and opens no session", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();

    const response = await browser.claim(jobId, "98100 00001", {}, { stage: "advanced" });
    expect(response.status).toBe(201);
    const body = await response.json<{ lead_id: string }>();
    expect(Object.keys(body)).toEqual(["lead_id"]);
    expect(response.headers.get("Set-Cookie")).toBeNull();

    const lead = await env.DB.prepare("SELECT source, city, first_choice_window, loss_extent FROM leads WHERE id = ?")
      .bind(body.lead_id)
      .first();
    expect(lead).toEqual({ source: "tryon", city: null, first_choice_window: null, loss_extent: "advanced" });
    const person = await env.DB.prepare("SELECT mobile_e164, contactable FROM people").first();
    expect(person).toEqual({ mobile_e164: "+919810000001", contactable: 0 }); // a try-on alone is not contact consent
    const consents = await env.DB.prepare(
      "SELECT purpose, notice_version, created_at, source FROM consents ORDER BY purpose",
    ).all();
    expect(consents.results).toEqual([
      { purpose: "result_delivery", notice_version: "gate-v3", created_at: NOW.toISOString(), source: "try_on" },
      { purpose: "tryon_photo", notice_version: "photo-v3", created_at: NOW.toISOString(), source: "try_on" },
    ]);
    expect(await jobRow(jobId)).toMatchObject({
      state: "awaiting_upload",
      lead_id: body.lead_id,
      claimed_at: NOW.toISOString(),
      session_id: null,
    });
    // The look's message waits for the render the claim comes before.
    const message = await env.DB.prepare("SELECT kind, state, subject_id FROM outbound_messages").first();
    expect(message).toEqual({ kind: "tryon_result", state: "waiting", subject_id: jobId });
    expect(await count("tryon_sessions")).toBe(0);
    expect(browser.queues.CRM_QUEUE.sent).toEqual([
      { lead_id: body.lead_id, request_id: expect.any(String) as string },
    ]);
    expect(browser.queues.MESSAGE_QUEUE.sent).toEqual([]);
  });

  it("refuses a job whose photograph has not arrived, or whose render was asked for already", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string }>();
    expect(await (await browser.claim(link.job_id)).json()).toMatchObject({ error: { code: "job_not_claimable" } });

    const failed = await browser.uploaded();
    await setState(failed, "failed");
    expect((await browser.claim(failed)).status).toBe(409);
    expect((await browser.claim(crypto.randomUUID())).status).toBe(404);
    expect((await browser.claim(failed, "12345")).status).toBe(400);
    expect(await count("leads")).toBe(0);
  });

  // ADR 0104: the gate's earlier notices said the result opens on the next screen.
  it("records the gate's current notice, and refuses any other", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    for (const version of ["gate-v1", "gate-v2", "photo-v3"]) {
      const refused = await browser.claim(jobId, "98100 00001", {}, { notice_version: version });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ error: { code: "invalid_request", fields: ["notice_version"] } });
    }
    expect((await browser.claim(jobId, "98100 00001", {}, { notice_version: "gate-v3" })).status).toBe(201);
    const consents = await env.DB.prepare("SELECT purpose, notice_version FROM consents ORDER BY purpose").all();
    expect(consents.results).toEqual([
      { purpose: "result_delivery", notice_version: "gate-v3" },
      { purpose: "tryon_photo", notice_version: "photo-v3" },
    ]);
  });

  it("asks for the stage the visitor chose", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const refused = await browser.post("/api/tryon/claim", {
      job_id: jobId,
      name: "Arjun Mehta",
      mobile: "98100 00001",
    });
    expect(refused.status).toBe(400);
  });

  // ADR 0104: a try-on whose look could not be sent does not run, so nothing of the claim is written.
  it("refuses while WhatsApp cannot send the look, writing nothing", async () => {
    const jobId = await visitor().uploaded();
    const refused = await visitor({ messaging: { enabled: false } }).claim(jobId);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "whatsapp_unavailable" } });
    for (const table of ["people", "consents", "leads", "outbound_messages"]) expect(await count(table)).toBe(0);
    expect((await jobRow(jobId))?.claimed_at).toBeNull();
  });

  // Owner ruling, 30 September 2026 ("logins open, reminders fenced", ADR 0025 item 84; ADR 0097): the look answers
  // the person who just claimed it, so it reaches any number, allowlisted or not.
  it("takes any number off the allowlist, since the look answers the person who just claimed it", async () => {
    const browser = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const jobId = await browser.uploaded();
    expect((await browser.claim(jobId, "98100 00001")).status).toBe(201);
  });

  // A record one of our own scripts made stays fenced (isStagingTestRecord, src/policy/staging-test-records.ts), and
  // its look would be held back, so its try-on does not run off the allowlist.
  it("refuses a 'Staging test' claim off the allowlist, and takes one on it", async () => {
    const browser = visitor({ messaging: { allowlist: ["+919810000002"] } });
    const jobId = await browser.uploaded();
    const asStagingTest = (mobile: string) =>
      browser.post("/api/tryon/claim", { job_id: jobId, name: "Staging test", mobile, stage: "crown" });
    expect(await (await asStagingTest("98100 00001")).json()).toMatchObject({
      error: { code: "whatsapp_unavailable" },
    });
    expect((await asStagingTest("98100 00002")).status).toBe(201);
  });

  it("refuses a number that has had its looks sent today, as the messaging queue would skip a fourth", async () => {
    const browser = visitor({ tryon: { resultMessageMobileDailyLimit: 0 } });
    const jobId = await browser.uploaded();
    const refused = await browser.claim(jobId);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(await count("leads")).toBe(0);
  });

  it("keeps a person who booked before contactable", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.prepare("UPDATE people SET contactable = 1").run();
    await visitor().claimed();
    expect(await env.DB.prepare("SELECT contactable FROM people").first()).toEqual({ contactable: 1 });
  });

  it("replays an idempotent claim with the same lead", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const first = await (await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" })).json();

    const replay = await browser.claim(jobId, "98100 00001", { "Idempotency-Key": "claim-key-1" });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(first);
    expect(await count("leads")).toBe(1);
  });

  it("gives the same number its lead again, after its render too, and refuses another number", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const first = await (await browser.claim(jobId)).json<{ lead_id: string }>();
    await browser.generate(jobId);

    const again = await browser.claim(jobId);
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    const stranger = await visitor().claim(jobId, "98100 00002");
    expect(stranger.status).toBe(409);
    expect(await count("leads")).toBe(1);
    expect(await count("outbound_messages")).toBe(1);
  });

  it("limits claims per number per day", async () => {
    const browser = visitor({ tryon: { claimMobileDailyLimit: 1 } });
    const first = await browser.uploaded();
    const second = await browser.uploaded();
    expect((await browser.claim(first)).status).toBe(201);
    expect((await browser.claim(second)).status).toBe(429);
  });
});

describe("POST /api/tryon/generate and GET /api/tryon/status", () => {
  // ADR 0104: the number is where the look goes, so no look is made without it.
  it("refuses a job the gate has not claimed", async () => {
    const browser = visitor();
    const jobId = await browser.uploaded();
    const refused = await browser.generate(jobId);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "claim_required" } });
    expect(await jobRow(jobId)).toMatchObject({ state: "awaiting_upload" });
    expect(browser.queues.RENDER_QUEUE.sent).toEqual([]);
    expect(browser.cookie("mm_look")).toBe("");
  });

  it("makes no look while WhatsApp cannot send it", async () => {
    const jobId = await visitor().claimed();
    const browser = visitor({ messaging: { enabled: false } });
    const refused = await browser.generate(jobId);
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "whatsapp_unavailable" } });
    expect(browser.queues.RENDER_QUEUE.sent).toEqual([]);
  });

  it("queues the first look of a claimed try-on, records the render choice and sends it to the render queue", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();

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
    const jobId = await browser.claimed();
    await browser.generate(jobId, { hair_color: "unknown" });
    expect(await jobRow(jobId)).toMatchObject({
      endpoint: "premium",
      provider_color: "original",
      color_route: "premium_original",
    });
  });

  it("returns the same job for the same request, without a second render", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    const again = await browser.generate(jobId);
    expect(await again.json()).toEqual({ job_id: jobId, state: "queued" });
    expect(browser.queues.RENDER_QUEUE.sent).toHaveLength(1);
  });

  it("refuses a different look for the same photo", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    const other = await browser.generate(jobId, { preset: "light-natural-short" });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ error: { code: "look_limit_reached" } });
  });

  it("trips the render ceiling at 3: the fourth answers 503 busy, fails its job and alerts once", async () => {
    const browser = visitor({ tryon: { renderDailyCeiling: 3, uploadIpHourlyLimit: 10, generateIpHourlyLimit: 10 } });
    const jobs = [
      await browser.claimed("98100 00001"),
      await browser.claimed("98100 00002"),
      await browser.claimed("98100 00003"),
      await browser.claimed("98100 00004"),
    ];

    for (const jobId of jobs.slice(0, 3)) expect((await browser.generate(jobId)).status).toBe(202);
    const fourth = await browser.generate(jobs[3] ?? "");
    expect(fourth.status).toBe(503);
    expect(await fourth.json()).toMatchObject({ error: { code: "busy" } });

    const status = await browser.call(`/api/tryon/status/${jobs[3] ?? ""}`);
    expect(await status.json()).toEqual({ job_id: jobs[3], state: "failed", failure_code: "busy" });
    // Its look's message is skipped with it.
    const skipped = await env.DB.prepare("SELECT state FROM outbound_messages WHERE subject_id = ?")
      .bind(jobs[3] ?? "")
      .first();
    expect(skipped).toEqual({ state: "skipped" });
    expect(browser.deps.alerts).toEqual([expect.stringContaining("render ceiling (3)") as string]);
  });

  it("limits renders per address per hour, and knows no unknown job", async () => {
    const browser = visitor({ tryon: { generateIpHourlyLimit: 1 } });
    expect((await browser.generate(crypto.randomUUID())).status).toBe(404);
    expect((await browser.generate(crypto.randomUUID())).status).toBe(429);
    expect((await browser.call(`/api/tryon/status/${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe("what a browser is told: never the look, which goes to WhatsApp only", () => {
  it("says whether the try-on runs, by whether WhatsApp can send its look", async () => {
    const on = await visitor().call("/api/tryon/availability");
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ available: true });
    const off = await visitor({ messaging: { enabled: false } }).call("/api/tryon/availability");
    expect(await off.json()).toEqual({ available: false });
  });

  it("hands a browser no look and no link to one, whoever it is", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    await makeReady(jobId);

    const asked = await browser.call(`/api/tryon/result/${jobId}`);
    expect(asked.status).toBe(404);
    const look = await browser.call("/api/tryon/look");
    expect(JSON.stringify(await look.json())).not.toMatch(/url|\/api\/result/);
  });

  it("tells a browser it has had its look, after the look is gone too", async () => {
    const browser = visitor();
    expect((await browser.call("/api/tryon/look")).status).toBe(404);
    const jobId = await browser.claimed();
    await browser.generate(jobId, { stage: "receding", preset: "light-natural-short" });

    const look = await browser.call("/api/tryon/look");
    expect(look.status).toBe(200);
    expect(await look.json()).toEqual({
      job_id: jobId,
      state: "queued",
      stage: "receding",
      preset: "light-natural-short",
    });
    // Expired, the browser has still had its look: the upload link refuses it another.
    await setState(jobId, "expired");
    expect(await (await browser.call("/api/tryon/look")).json()).toMatchObject({ state: "expired" });
    expect((await browser.uploadLink()).status).toBe(403);
  });

  it("refuses a look cookie that is made up, altered or stale", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);

    const forger = visitor();
    forger.useCookie("mm_look", jobId); // the bare job ID, as the cookie held before it was signed
    expect((await forger.call("/api/tryon/look")).status).toBe(404);
    forger.useCookie("mm_look", `${browser.cookie("mm_look")}x`);
    expect((await forger.call("/api/tryon/look")).status).toBe(404);

    const later = visitor({ deps: fakeDependencies({ now: () => new Date(NOW.getTime() + 31 * 24 * 3_600_000) }) });
    later.useCookie("mm_look", browser.cookie("mm_look"));
    expect((await later.call("/api/tryon/look")).status).toBe(404);
  });

  it("refuses a second photo from a browser that already has its look", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
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
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    await setState(jobId, "failed", ", failure_code = 'photo_unreadable'");

    expect((await browser.uploadLink()).status).toBe(201);
  });
});

describe("GET /api/result/:token, the link a WhatsApp message carries", () => {
  it("serves the look to the WhatsApp bridge for the link's hour, and no longer", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    const link = await messageLink(await makeReady(jobId));

    const image = await browser.call(link);
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await image.arrayBuffer()).slice(0, 4)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));

    const anHourOn = visitor({ deps: fakeDependencies({ now: () => new Date(NOW.getTime() + 61 * 60_000) }) });
    expect((await anHourOn.call(link)).status).toBe(404);
  });

  it("refuses an invalid link, and answers busy past the daily read ceiling", async () => {
    const browser = visitor({ tryon: { resultReadDailyCeiling: 1 } });
    expect((await browser.call("/api/result/not-a-token")).status).toBe(404);

    const jobId = await browser.claimed();
    await browser.generate(jobId);
    const link = await messageLink(await makeReady(jobId));
    expect((await browser.call(link)).status).toBe(200);
    expect((await browser.call(link)).status).toBe(503);
    expect(browser.deps.alerts).toEqual([expect.stringContaining("result_read ceiling (1)") as string]);
  });

  it("answers 404 once the result has been deleted", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);
    const resultKey = await makeReady(jobId);
    await env.RESULTS.delete(resultKey);
    expect((await browser.call(await messageLink(resultKey))).status).toBe(404);
  });
});

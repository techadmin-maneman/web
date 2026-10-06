import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NOW, captureLogs, eraseByMobile, fakeDependencies, markDatabase } from "../helpers.ts";
import { visitor, jobRow, setState, makeReady } from "./tryon-api-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
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

  it("queues the first look of a claimed try-on, for the claim's stage, and sends it to the render queue", async () => {
    const browser = visitor();
    const jobId = await browser.claimed("98100 00001", "receding");

    const response = await browser.generate(jobId, { preset: "light-receded-cropped", hair_color: "grey" });
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

  // The stage is the claim's alone, so the lead and the render cannot disagree.
  it("takes no stage of its own", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    const refused = await browser.generate(jobId, { stage: "advanced" });
    expect(refused.status).toBe(400);
    expect(await jobRow(jobId)).toMatchObject({ state: "awaiting_upload", stage: "crown" });
  });

  it("routes an unknown colour to Pro in black, and records why", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId, { hair_color: "unknown" });
    expect(await jobRow(jobId)).toMatchObject({
      endpoint: "pro",
      provider_color: "black",
      color_route: "pro_black",
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

  // The claim checks the number, but jobs claimed before any is asked for must not each make a look.
  it("makes one look for a number that claimed several jobs before asking for any", async () => {
    const browser = visitor({ tryon: { claimMobileDailyLimit: 10, generateIpHourlyLimit: 10 } });
    const first = await browser.claimed();
    const second = await browser.claimed();

    expect((await browser.generate(first)).status).toBe(202);
    const refused = await browser.generate(second);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "look_limit_reached" } });
    expect(await jobRow(second)).toMatchObject({ state: "awaiting_upload" });
    expect(browser.queues.RENDER_QUEUE.sent).toHaveLength(1);

    // Its render failed, so the number may have its look from the other.
    await setState(first, "failed");
    expect((await browser.generate(second)).status).toBe(202);
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

  // Its state alone: not the stage or the look asked for, which an erasure leaves on an expired job's row.
  it("tells a browser it has had its look, and nothing of what it asked, after the look is gone too", async () => {
    const browser = visitor();
    const none = await browser.call("/api/tryon/look");
    // No look yet is an answer, not an error, so a new visitor's console logs no failed request.
    expect(none.status).toBe(204);
    expect(await none.text()).toBe("");
    const jobId = await browser.claimed("98100 00001", "receding");
    await browser.generate(jobId, { preset: "light-natural-short" });

    const look = await browser.call("/api/tryon/look");
    expect(look.status).toBe(200);
    expect(await look.json()).toEqual({ job_id: jobId, state: "queued" });

    // Erased, and so expired, the browser has still had its look: the upload link refuses it another.
    expect(await eraseByMobile("+919810000001")).not.toBeNull();
    expect(await jobRow(jobId)).toMatchObject({ state: "expired", stage: "receding", preset: "light-natural-short" });
    expect(await (await browser.call("/api/tryon/look")).json()).toEqual({ job_id: jobId, state: "expired" });
    expect((await browser.uploadLink()).status).toBe(403);
  });

  it("reads a look cookie that is made up, altered or stale as no look", async () => {
    const browser = visitor();
    const jobId = await browser.claimed();
    await browser.generate(jobId);

    const forger = visitor();
    forger.useCookie("mm_look", jobId); // the bare job ID, as the cookie held before it was signed
    expect((await forger.call("/api/tryon/look")).status).toBe(204);
    forger.useCookie("mm_look", `${browser.cookie("mm_look")}x`);
    expect((await forger.call("/api/tryon/look")).status).toBe(204);

    const later = visitor({ deps: fakeDependencies({ now: () => new Date(NOW.getTime() + 31 * 24 * 3_600_000) }) });
    later.useCookie("mm_look", browser.cookie("mm_look"));
    expect((await later.call("/api/tryon/look")).status).toBe(204);
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

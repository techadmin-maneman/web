import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, RESULT_LINK_MESSAGE_TTL_MS } from "../../../src/config/tryon.ts";
import { signToken } from "../../../src/lib/signed-token.ts";
import {
  LOCAL_SETTINGS,
  NOW,
  TURNSTILE_URL,
  captureLogs,
  fakeDependencies,
  fakeFetch,
  json,
  markDatabase,
} from "../helpers.ts";
import { syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";
import { visitor, jobRow, count, makeReady } from "./tryon-api-fixtures.ts";

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
      photo_consent_version: "photo-v4",
      photo_consent_at: NOW.toISOString(),
      session_id: null,
      person_id: null,
    });
  });

  // Every earlier photo notice says something no longer true: the look on screen, or who sees the photograph.
  it("refuses consent that is not literally true, and any notice but the current photo notice", async () => {
    const browser = visitor();
    for (const body of [
      { photo_consent: false },
      { notice_version: "booking-v1" },
      { notice_version: "photo-v1" },
      { notice_version: "photo-v2" },
      { notice_version: "photo-v3" },
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

  // A body sent without its length read as 0 bytes declared, and was read whole, however long.
  it("refuses a body over 5 MB sent without its length", async () => {
    const browser = visitor();
    const link = await (await browser.uploadLink()).json<{ job_id: string; upload_url: string }>();
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(syntheticJpeg(800, 800));
    const body = new Blob([big]).stream();
    const response = await browser.call(link.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body,
    });
    expect(response.status).toBe(422);
    expect(await env.UPLOADS.head(`uploads/${link.job_id}`)).toBeNull();
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

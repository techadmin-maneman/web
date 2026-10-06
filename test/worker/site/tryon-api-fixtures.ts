// What the try-on API tests share (tryon-api*.test.ts): the settings a test changes, a visitor, a try-on job's row and
// its state set by hand, and a look made ready.

import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { toE164 } from "../../../src/lib/mobile.ts";
import {
  LOCAL_SETTINGS,
  appFor,
  fakeDependencies,
  fakeQueue,
  provedNumberCode,
  request,
  type TestDependencies,
} from "../helpers.ts";
import { syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";

export type TryonSettingsOverride = Partial<Settings["tryon"]>;

/** The try-on API as one visitor's browser sees it: it keeps its cookie (mm_look) between calls. */
export function visitor(
  options: { tryon?: TryonSettingsOverride; messaging?: Partial<Settings["messaging"]>; deps?: TestDependencies } = {},
) {
  const deps = options.deps ?? fakeDependencies();
  const app = appFor("local", deps, {
    tryon: { ...LOCAL_SETTINGS.tryon, ...options.tryon },
    messaging: { ...LOCAL_SETTINGS.messaging, ...options.messaging },
  });
  const queues = { RENDER_QUEUE: fakeQueue(), CRM_QUEUE: fakeQueue(), MESSAGE_QUEUE: fakeQueue() };
  const cookies = new Map<string, string>();
  // One code a number, so a claim sent again is the same request.
  const proofs = new Map<string, string>();
  const proofOf = async (mobile: string): Promise<{ number_code_id?: string }> => {
    const mobileE164 = toE164(mobile);
    if (mobileE164 === null) return {};
    const known = proofs.get(mobileE164) ?? (await provedNumberCode(mobileE164));
    proofs.set(mobileE164, known);
    return { number_code_id: known };
  };

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
      post("/api/tryon/upload-url", { photo_consent: true, notice_version: "photo-v4", turnstile_token: "t", ...body }),
    put: (path: string, bytes: Uint8Array, contentType = "image/jpeg") =>
      call(path, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes }),
    async uploaded(bytes: Uint8Array = syntheticJpeg(800, 800)): Promise<string> {
      const link = await (await this.uploadLink()).json<{ job_id: string; upload_url: string }>();
      expect((await this.put(link.upload_url, bytes)).status).toBe(204);
      return link.job_id;
    },
    /** The gate, with the number proved by a code unless `body` says otherwise. */
    claim: async (jobId: string, mobile = "98100 00001", headers: Record<string, string> = {}, body = {}) =>
      post(
        "/api/tryon/claim",
        { job_id: jobId, name: "Arjun Mehta", mobile, stage: "crown", ...(await proofOf(mobile)), ...body },
        headers,
      ),
    proofOf,
    /** Uploaded, and claimed at the gate for a stage: ready for its render. */
    async claimed(mobile = "98100 00001", stage = "crown"): Promise<string> {
      const jobId = await this.uploaded();
      expect((await this.claim(jobId, mobile, {}, { stage })).status).toBe(201);
      return jobId;
    },
    generate: (jobId: string, body: Record<string, unknown> = {}) =>
      post("/api/tryon/generate", {
        job_id: jobId,
        preset: "full-natural-short",
        hair_color: "black",
        ...body,
      }),
  };
}

export function jobRow(id: string) {
  return env.DB.prepare("SELECT * FROM tryon_jobs WHERE id = ?").bind(id).first();
}

export async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setState(id: string, state: string, extra = ""): Promise<void> {
  await env.DB.prepare(`UPDATE tryon_jobs SET state = ?${extra} WHERE id = ?`).bind(state, id).run();
}

export async function makeReady(id: string): Promise<string> {
  const key = `results/${id}.png`;
  await env.RESULTS.put(key, syntheticPng(512, 512), { httpMetadata: { contentType: "image/png" } });
  await env.DB.prepare("UPDATE tryon_jobs SET state = 'ready', result_key = ? WHERE id = ?").bind(key, id).run();
  return key;
}

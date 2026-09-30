// Runs one try-on on staging through the real API, past Cloudflare Access (a
// service token) and Turnstile (Cloudflare's dummy token, which only staging
// accepts), and reports what happened at each step. Used for the M3 proofs.
//
//   node --env-file=.env.staging-access scripts/staging-tryon.ts --photo <path> \
//     [--preset full-natural-short] [--color black] [--stage crown] \
//     [--claim running|ready|none] [--look <another preset>]
//
// --claim running  submits the gate while the render is still running (the default)
// --look           asks for a second look once the first is ready
//
// The gate uses the number in STAGING_TEST_MOBILE. The result answers the person who claimed it (ADR 0097), so it
// reaches any real WhatsApp number given here, on the allowlist or not; a made-up number just fails delivery.
// The number is never printed in full. The photo is read from disk and never copied into the repository.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { inspectImage } from "../src/lib/image-bytes.ts";
import { TURNSTILE_TEST_TOKEN } from "../src/providers/turnstile.ts";

const { values } = parseArgs({
  options: {
    photo: { type: "string" },
    preset: { type: "string", default: "full-natural-short" },
    color: { type: "string", default: "black" },
    stage: { type: "string", default: "crown" },
    claim: { type: "string", default: "running" },
    look: { type: "string" },
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});
if (values.photo === undefined) {
  console.error(
    "usage: staging-tryon.ts --photo <path> [--preset …] [--color …] [--claim running|ready|none] [--look …]",
  );
  process.exit(2);
}

const POLL_EVERY_MS = 3_000;
// The render consumer follows a render for 15 minutes (src/config/pipeline.ts).
const GIVE_UP_AFTER_MS = 16 * 60 * 1000;
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;
const mobile = process.env.STAGING_TEST_MOBILE ?? `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
let cookie = "";

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("CF-Access-Client-Id", process.env.CF_ACCESS_CLIENT_ID ?? "");
  headers.set("CF-Access-Client-Secret", process.env.CF_ACCESS_CLIENT_SECRET ?? "");
  if (cookie !== "") headers.set("Cookie", cookie);
  const response = await fetch(`${values.base}${path}`, { ...init, headers, redirect: "manual" });
  const set = response.headers.get("Set-Cookie");
  if (set?.startsWith("mm_tryon=")) cookie = set.split(";")[0] ?? "";
  if (response.status === 302) throw new Error("Cloudflare Access redirected: check CF_ACCESS_CLIENT_ID and _SECRET");
  return response;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json<Record<string, unknown>>() };
}

function step(label: string, detail: unknown): void {
  console.log(`[${elapsed()}] ${label}: ${JSON.stringify(detail)}`);
}

async function waitForResult(jobId: string): Promise<string> {
  let last = "";
  for (;;) {
    const status = await (await call(`/api/tryon/status/${jobId}`)).json<{ state: string; failure_code?: string }>();
    if (status.state !== last) step(`job ${jobId.slice(0, 8)}`, status);
    last = status.state;
    if (["ready", "failed", "expired"].includes(status.state)) return status.state;
    if (Date.now() - started > GIVE_UP_AFTER_MS) throw new Error("gave up waiting");
    await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
  }
}

async function claim(jobId: string): Promise<void> {
  const gate = await post("/api/tryon/claim", { job_id: jobId, name: "Staging test", mobile });
  step("claim", { status: gate.status, ...gate.body, mobile: `…${mobile.slice(-4)}`, session: cookie !== "" });
}

async function showResult(jobId: string): Promise<void> {
  const result = await call(`/api/tryon/result/${jobId}`);
  const body = await result.json<{ url?: string }>();
  if (result.status !== 200 || body.url === undefined) {
    step("result", { status: result.status, ...body });
    return;
  }
  const image = await call(body.url);
  const bytes = new Uint8Array(await image.arrayBuffer());
  step("result image", { status: image.status, bytes: bytes.byteLength, ...inspectImage(bytes) });
}

// 1. Consent and an upload link; 2. the photo; 3. the first look.
const link = await post("/api/tryon/upload-url", {
  photo_consent: true,
  notice_version: "photo-v1",
  turnstile_token: TURNSTILE_TEST_TOKEN,
});
step("upload link", { status: link.status, job_id: link.body.job_id });
const jobId = String(link.body.job_id);
const photo = new Uint8Array(readFileSync(values.photo));
const upload = await call(String(link.body.upload_url), { method: "PUT", body: photo });
step("upload", { status: upload.status, bytes: photo.byteLength, ...inspectImage(photo) });
const look = { job_id: jobId, stage: values.stage, preset: values.preset, hair_color: values.color };
step("generate", await post("/api/tryon/generate", look));

// 4. The gate, while rendering or once ready; 5. the result.
if (values.claim === "running") await claim(jobId);
const state = await waitForResult(jobId);
if (values.claim === "ready" && state === "ready") await claim(jobId);
if (values.claim !== "none") await showResult(jobId);

// 6. Another look of the same photo: no second gate, no second lead.
if (values.look !== undefined && state === "ready") {
  const second = await post("/api/tryon/generate", { ...look, preset: values.look });
  step("another look", second);
  const secondId = String(second.body.job_id);
  if ((await waitForResult(secondId)) === "ready") await showResult(secondId);
}

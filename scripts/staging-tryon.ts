// Runs one try-on on staging through the real API, past Cloudflare Access (a
// service token) and Turnstile (Cloudflare's dummy token, which only staging
// accepts), and reports what happened at each step. Used for the M3 proofs.
//
//   node --env-file=.env.staging-access scripts/staging-tryon.ts --photo <path> \
//     [--preset full-natural-short] [--color black] [--stage crown]
//
// The look goes to WhatsApp only (docs/decisions/0104-the-try-ons-look-on-whatsapp-only.md), so the gate is
// claimed before the render, and the look is checked on the handset, not here: the script follows the job until it
// is ready. The gate uses the number in STAGING_TEST_MOBILE, as "Staging test", which is messaged only on the
// allowlist (ADR 0097), so that number must be on it: off it, the claim is refused (whatsapp_unavailable). The
// number is never printed in full. The photo is read from disk and never copied into the repository.

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
    base: { type: "string", default: "https://staging.maneman.in" },
  },
});
const mobile = process.env.STAGING_TEST_MOBILE;
if (values.photo === undefined || mobile === undefined) {
  console.error(
    "usage: STAGING_TEST_MOBILE=<allowlisted number> staging-tryon.ts --photo <path> [--preset …] [--color …]",
  );
  process.exit(2);
}

const POLL_EVERY_MS = 3_000;
// The render consumer follows a render for 15 minutes (src/config/pipeline.ts).
const GIVE_UP_AFTER_MS = 16 * 60 * 1000;
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)} s`;

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("CF-Access-Client-Id", process.env.CF_ACCESS_CLIENT_ID ?? "");
  headers.set("CF-Access-Client-Secret", process.env.CF_ACCESS_CLIENT_SECRET ?? "");
  const response = await fetch(`${values.base}${path}`, { ...init, headers, redirect: "manual" });
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

// 1. Consent and an upload link; 2. the photo.
const link = await post("/api/tryon/upload-url", {
  photo_consent: true,
  notice_version: "photo-v3",
  turnstile_token: TURNSTILE_TEST_TOKEN,
});
step("upload link", { status: link.status, job_id: link.body.job_id });
const jobId = String(link.body.job_id);
const photo = new Uint8Array(readFileSync(values.photo));
const upload = await call(String(link.body.upload_url), { method: "PUT", body: photo });
step("upload", { status: upload.status, bytes: photo.byteLength, ...inspectImage(photo) });

// 3. The gate, where the look will go; 4. the look; 5. its render, whose message then goes to the handset.
const gate = await post("/api/tryon/claim", { job_id: jobId, name: "Staging test", mobile, stage: values.stage });
step("claim", { status: gate.status, ...gate.body, mobile: `…${mobile.slice(-4)}` });
const look = { job_id: jobId, preset: values.preset, hair_color: values.color };
step("generate", await post("/api/tryon/generate", look));
step("result", { state: await waitForResult(jobId), check: "the look on the handset's WhatsApp" });

// YouCam (Perfect Corp) hair-transfer V2.1 in reference mode, following docs/reference/youcam-api-notes.md. Only
// src/providers/image/index.ts imports this module.
//
//   submit  POST /s2s/v2.0/file                   a signed upload URL for the photograph, then PUT to it
//           POST /s2s/v2.1/task/hair-transfer     src_file_id, the look's reference URL, hair_color "src"
//   poll    GET  /s2s/v2.1/task/hair-transfer/…   running, success (results.url) or error (data.error)
//   credits GET  /s2s/v1.0/client/credit          results[].amount_dec, summed
//
// The key goes only to YouCam's API host, never to the signed upload URL or the result's.

import { z } from "zod";
import type { FailureReason } from "../../config/tryon.ts";
import { inspectImage } from "../../lib/image-bytes.ts";
import type { Logger } from "../../log.ts";
import type { ImageProvider, PollResult, RenderFailure, SubmitResult } from "./index.ts";
import { downloadResult } from "./result-download.ts";
import { vendorFetch, VendorUnreachable } from "../vendor-fetch.ts";

export const API_BASE_URL = "https://yce-api-01.makeupar.com";
export const FILE_PATH = "/s2s/v2.0/file";
export const TASK_PATH = "/s2s/v2.1/task/hair-transfer";
export const CREDIT_PATH = "/s2s/v1.0/client/credit";

const CALL_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 30_000;

/** What an answer may carry; a field of the wrong kind reads as absent, since the error fields say why it failed. */
const ApiBody = z.object({
  error_code: z.union([z.string(), z.number()]).optional().catch(undefined),
  error: z.unknown().optional(),
  message: z.unknown().optional(),
  data: z.unknown().optional(),
});
type ApiBody = z.infer<typeof ApiBody>;

const UploadData = z.object({
  files: z.array(
    z.object({
      file_id: z.coerce.string(),
      requests: z.array(
        z.object({
          method: z.string().catch("PUT"),
          url: z.url(),
          headers: z.record(z.string(), z.coerce.string()).catch({}),
        }),
      ),
    }),
  ),
});

const TaskData = z.object({ task_id: z.coerce.string() });

const PollData = z.object({
  task_status: z.string().catch(""),
  results: z
    .union([z.object({ url: z.string() }), z.array(z.object({ url: z.string() })).transform((list) => list[0])])
    .optional()
    .catch(undefined),
  error: z.string().nullish().catch(null),
  error_message: z.unknown().optional(),
});

const Pool = z.object({ amount_dec: z.coerce.number().catch(0) });
const Credit = z.object({
  results: z.array(Pool).optional(),
  data: z.object({ results: z.array(Pool).optional() }).optional(),
});

/** YouCam's own code in an answer, for the log. */
function errorCodeOf(body: unknown): string | null {
  const code = ApiBody.safeParse(body).data?.error_code;
  return code === undefined ? null : String(code);
}

/** What the page says of a photograph YouCam refused, by YouCam's code. */
const PHOTO_REFUSALS: Readonly<Record<string, FailureReason>> = {
  error_no_shoulder: "no_shoulders",
  error_large_face_angle: "face_angle",
  error_face_pose: "face_angle",
  error_pose: "face_angle",
  error_no_face: "no_face",
  error_insufficient_landmarks: "no_face",
  error_multiple_people: "several_people",
  error_nsfw_content_detected: "refused",
};

/** Refusals of a photograph our own preparation should never have sent: a fault of ours, for engineering. */
const PREPARATION_FAULTS = new Set([
  "exceed_max_filesize",
  "error_exceed_max_image_size",
  "error_decode_image",
  "error_unsupport_ratio",
]);

/** YouCam saying the hair is too short to style: never seen in our tests, and fatal to a try-on for hair loss. */
const HAIR_GATES = new Set(["error_hair_too_short", "error_bald_image"]);

/** YouCam's model failing on a photograph it took: worth one render more. */
const MODEL_FAULTS = new Set(["error_inference", "unknown_internal_error"]);

/** The API refusing the key itself. */
const KEY_REFUSALS = new Set(["InvalidAccessToken", "InvalidApiKey", "InactiveApiKey", "ExpiredApiKey"]);

/** A task's own error code, classified. */
export function classifyTaskError(code: string): Omit<RenderFailure, "detail"> {
  const reason = PHOTO_REFUSALS[code];
  if (reason !== undefined) return { code: "photo_unreadable", reason, transient: false, alert: false };
  if (HAIR_GATES.has(code)) {
    return { code: "photo_unreadable", reason: "not_styleable", transient: false, alert: true };
  }
  if (MODEL_FAULTS.has(code)) return { code: "render_failed", transient: false, retryOnce: true, alert: false };
  if (PREPARATION_FAULTS.has(code)) return { code: "render_failed", transient: false, alert: true };
  return { code: "render_failed", transient: false, alert: true };
}

/** A call's failed answer, by its HTTP status and YouCam's code. */
export function classifyHttpError(status: number, code: string | null): Omit<RenderFailure, "detail"> {
  if (status === 401 || (code !== null && KEY_REFUSALS.has(code))) {
    return { code: "render_failed", reason: "unavailable", transient: false, alert: true, urgentKey: "tryon_paused:key" };
  }
  if (code === "CreditInsufficiency") {
    return {
      code: "render_failed",
      reason: "unavailable",
      transient: false,
      alert: true,
      urgentKey: "tryon_paused:credits",
    };
  }
  if (status === 429 || status >= 500) return { code: "render_failed", transient: true, alert: false };
  if (code !== null && code.startsWith("error_")) return classifyTaskError(code);
  // Any other refusal is a request we built wrongly.
  return { code: "render_failed", transient: false, alert: true };
}

/** A call that never reached YouCam: worth another try. */
const unreachable = (error: VendorUnreachable): RenderFailure => ({
  code: "render_failed",
  transient: true,
  alert: false,
  detail: error.message,
});

async function readBody(response: Response): Promise<ApiBody | null> {
  const answer = ApiBody.safeParse(await response.json().catch(() => null));
  return answer.success ? answer.data : null;
}

export function createYoucamProvider(options: { apiKey: string; fetch: typeof fetch; log: Logger }): ImageProvider {
  const { apiKey } = options;
  const http = { fetch: options.fetch, log: options.log };
  const scrub = (text: string): string => text.split(apiKey).join("***REDACTED***");
  const authorised = { Authorization: `Bearer ${apiKey}` };

  /** A failed answer, classified, with YouCam's code kept verbatim in the detail and never the key. */
  const failed = (status: number, body: ApiBody | null, step: string): RenderFailure => {
    const code = body?.error_code === undefined ? null : String(body.error_code);
    const detail = scrub(
      JSON.stringify({ step, http_status: status, error_code: code, error: body?.error ?? body?.message ?? null }),
    ).slice(0, 1000);
    return { ...classifyHttpError(status, code), detail };
  };

  const call = (step: string, path: string, init: RequestInit = {}) =>
    vendorFetch(http, { vendor: "youcam", step, timeoutMs: CALL_TIMEOUT_MS, codeOf: errorCodeOf }, API_BASE_URL + path, {
      ...init,
      headers: { ...authorised, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
    });

  /** The photograph uploaded through a signed URL: its file ID, or why it is not there. */
  async function upload(image: Uint8Array): Promise<{ ok: true; fileId: string } | { ok: false; failure: RenderFailure }> {
    const file = { content_type: "image/jpg", file_name: "selfie.jpg", file_size: image.byteLength };
    const asked = await call("upload_url", FILE_PATH, { method: "POST", body: JSON.stringify({ files: [file] }) });
    if (asked instanceof VendorUnreachable) return { ok: false, failure: unreachable(asked) };
    const body = await readBody(asked);
    const target = UploadData.safeParse(body?.data).data?.files[0];
    const request = target?.requests[0];
    if (!asked.ok || target === undefined || request === undefined) {
      return { ok: false, failure: failed(asked.status, body, "upload_url") };
    }

    // A signed storage URL: exactly the headers it was given, and no key.
    const put = await vendorFetch(
      http,
      { vendor: "youcam", step: "upload", timeoutMs: UPLOAD_TIMEOUT_MS },
      request.url,
      { method: request.method, headers: request.headers, body: image },
    );
    if (put instanceof VendorUnreachable) return { ok: false, failure: unreachable(put) };
    if (!put.ok) {
      const transient = put.status === 429 || put.status >= 500;
      const detail = `signed upload refused: HTTP ${String(put.status)}`;
      return { ok: false, failure: { code: "render_failed", transient, alert: !transient, detail } };
    }
    return { ok: true, fileId: target.file_id };
  }

  return {
    async submit(image, referenceUrl): Promise<SubmitResult> {
      if (inspectImage(image)?.type !== "image/jpeg") {
        // The browser makes every photograph a JPEG: one that is not is a fault of ours.
        return {
          ok: false,
          failure: { code: "photo_invalid_file", transient: false, alert: true, detail: "not a JPEG" },
        };
      }
      const uploaded = await upload(image);
      if (!uploaded.ok) return uploaded;

      // The customer keeps their own colour: no colour is ever chosen.
      const task = { src_file_id: uploaded.fileId, ref_file_url: referenceUrl, hair_color: "src" };
      const response = await call("submit", TASK_PATH, { method: "POST", body: JSON.stringify(task) });
      if (response instanceof VendorUnreachable) return { ok: false, failure: unreachable(response) };
      const body = await readBody(response);
      const taskId = TaskData.safeParse(body?.data).data?.task_id ?? "";
      if (response.ok && taskId !== "") return { ok: true, taskId };
      return { ok: false, failure: failed(response.status, body, "submit") };
    },

    async poll(taskId): Promise<PollResult> {
      const response = await call("poll", `${TASK_PATH}/${encodeURIComponent(taskId)}`);
      if (response instanceof VendorUnreachable) return { state: "failed", failure: unreachable(response) };
      const body = await readBody(response);
      if (!response.ok) return { state: "failed", failure: failed(response.status, body, "poll") };

      const data = PollData.safeParse(body?.data).data;
      if (data?.task_status === "success") {
        const url = data.results?.url ?? "";
        if (url !== "") return { state: "done", resultUrl: url };
        const detail = "task succeeded with no result URL";
        return { state: "failed", failure: { code: "render_failed", transient: false, alert: true, detail } };
      }
      if (data?.task_status === "error") {
        const code = data.error ?? "error";
        const detail = scrub(JSON.stringify({ step: "task", error: code, error_message: data.error_message ?? null }));
        return { state: "failed", failure: { ...classifyTaskError(code), detail: detail.slice(0, 1000) } };
      }
      return { state: "running" };
    },

    download: (url) => downloadResult(http, { vendor: "youcam", url, scrub }),

    async credits(): Promise<number | null> {
      const response = await call("credits", CREDIT_PATH);
      if (response instanceof VendorUnreachable || !response.ok) return null;
      const answer = Credit.safeParse(await response.json().catch(() => null));
      if (!answer.success) return null;
      const pools = answer.data.results ?? answer.data.data?.results ?? [];
      return pools.reduce((total, pool) => total + pool.amount_dec, 0);
    },
  };
}

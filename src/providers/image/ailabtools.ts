// AILabTools, following the measured facts in
// docs/reference/ailabtools-api-notes.md (section numbers below). Only
// src/providers/image/index.ts imports this module.
//
//   submit  POST /api/portrait/effects/hairstyle-editor-pro       (3)  multipart
//           POST /api/portrait/effects/hairstyle-editor-premium   (4)  multipart
//   poll    GET  /api/common/query-async-task-result?task_id=…    (1)
//   credits GET  /api/common/query-credits                        (0)  data[] pools, summed
//
// Endpoint A (hairstyle-editor) is dead (7.1) and never called.

import { z } from "zod";
import type { Endpoint, Preset } from "../../config/presets.ts";
import { MAX_RESULT_BYTES } from "../../config/tryon.ts";
import { fileExtension, inspectImage } from "../../lib/image-bytes.ts";
import type { Logger } from "../../log.ts";
import type { DownloadResult, ImageProvider, PollResult, ProviderColor, RenderFailure, SubmitResult } from "./index.ts";
import { vendorFetch, VendorUnreachable } from "../vendor-fetch.ts";

export const API_BASE_URL = "https://www.ailabapi.com";
export const ENDPOINT_PATHS: Readonly<Record<Endpoint, string>> = {
  pro: "/api/portrait/effects/hairstyle-editor-pro",
  premium: "/api/portrait/effects/hairstyle-editor-premium",
};
export const POLL_PATH = "/api/common/query-async-task-result";
export const CREDITS_PATH = "/api/common/query-credits";

const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 15_000;
const CREDITS_TIMEOUT_MS = 10_000;
/** The result host stalls now and then; fail each try fast and try again (7.10). */
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_TIMEOUT_MS = 20_000;

/** Where a task stands, from the poll response (1). */
const TASK_DONE = 2;

/**
 * What an answer may carry (sections 0 to 4). A field of the wrong kind reads
 * as absent rather than failing the whole answer, since the error fields are
 * what says why a call failed.
 */
const ApiBody = z.object({
  error_code: z.union([z.number(), z.string()]).optional().catch(undefined),
  error_msg: z.unknown().optional(),
  error_detail: z.unknown().optional(),
  task_id: z.string().optional().catch(undefined),
  task_status: z.coerce.number().optional().catch(undefined),
  data: z.unknown().optional(),
});
type ApiBody = z.infer<typeof ApiBody>;

/** A finished task's result: Pro lists its images, Premium names one (0). */
const ResultData = z.object({
  images: z.array(z.string()).optional().catch(undefined),
  image: z.string().optional().catch(undefined),
});

/** The credit pools, a list or a single one, read as a list; a balance that is not a number counts as none. */
const Pool = z.object({ balance: z.coerce.number().catch(0) });
const Credits = z.object({ data: z.union([z.array(Pool), Pool.transform((pool) => [pool])]).optional() });

/** AILabTools' own code in an answer, for the log. */
function errorCodeOf(body: unknown): string | null {
  const code = ApiBody.safeParse(body).data?.error_code;
  return code === undefined ? null : String(code);
}

export function createAilabtoolsProvider(options: { apiKey: string; fetch: typeof fetch; log: Logger }): ImageProvider {
  const { apiKey } = options;
  const http = { fetch: options.fetch, log: options.log };
  const scrub = (text: string): string => text.split(apiKey).join("***REDACTED***");
  const authorised = { "ailabapi-api-key": apiKey };

  /** A failed call, classified, with a detail that never carries the key. */
  const failure = (status: number, body: ApiBody | null, context: string): RenderFailure => {
    const detail = scrub(
      JSON.stringify({
        context,
        http_status: status,
        error_code: body?.error_code ?? null,
        error_msg: body?.error_msg ?? null,
        error_detail: body?.error_detail ?? null,
      }),
    ).slice(0, 1000);
    return { ...classify(status, body), detail };
  };

  const unreachable = (error: VendorUnreachable): RenderFailure => ({
    code: "render_failed",
    transient: true,
    alert: false,
    detail: error.message,
  });

  /** One try at a result: its bytes, a result no retry will make usable, or why this try failed. */
  async function downloadOnce(url: string): Promise<DownloadResult> {
    // No API key: it must never reach whatever host serves the results (7.10).
    const call = { vendor: "ailabtools", step: "download", timeoutMs: DOWNLOAD_TIMEOUT_MS } as const;
    const response = await vendorFetch(http, call, url);
    if (response instanceof VendorUnreachable) return stalled(response.reason);
    if (!response.ok) return stalled(`HTTP ${String(response.status)}`);

    // A result declared too large is refused before a byte of it is read.
    const declared = Number(response.headers.get("Content-Length") ?? "0");
    if (declared > MAX_RESULT_BYTES) {
      await response.body?.cancel();
      return unusable(`result is ${String(declared)} bytes`);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return stalled(error instanceof Error ? error.name : "error");
    }
    if (bytes.byteLength > MAX_RESULT_BYTES) return unusable(`result is ${String(bytes.byteLength)} bytes`);
    const info = inspectImage(bytes);
    if (info === null) return unusable("result is not a JPEG or PNG");
    return { ok: true, bytes, contentType: info.type };
  }

  return {
    async submit(image, preset, color, endpoint): Promise<SubmitResult> {
      const info = inspectImage(image);
      if (info === null) {
        return {
          ok: false,
          failure: { code: "photo_invalid_file", transient: false, alert: false, detail: "not a JPEG or PNG" },
        };
      }

      const response = await vendorFetch(
        http,
        { vendor: "ailabtools", step: "submit", timeoutMs: SUBMIT_TIMEOUT_MS, codeOf: errorCodeOf },
        `${API_BASE_URL}${ENDPOINT_PATHS[endpoint]}`,
        { method: "POST", headers: authorised, body: submitForm(image, info.type, preset, color, endpoint) },
      );
      if (response instanceof VendorUnreachable) return { ok: false, failure: unreachable(response) };

      const body = await readBody(response);
      const taskId = body?.task_id ?? "";
      if (response.ok && isSuccess(body) && taskId !== "") return { ok: true, taskId };
      return { ok: false, failure: failure(response.status, body, "submit") };
    },

    async poll(taskId, endpoint): Promise<PollResult> {
      const response = await vendorFetch(
        http,
        { vendor: "ailabtools", step: "poll", timeoutMs: POLL_TIMEOUT_MS, codeOf: errorCodeOf },
        `${API_BASE_URL}${POLL_PATH}?task_id=${encodeURIComponent(taskId)}`,
        { headers: authorised },
      );
      if (response instanceof VendorUnreachable) return { state: "failed", failure: unreachable(response) };

      const body = await readBody(response);
      if (!response.ok || !isSuccess(body)) return { state: "failed", failure: failure(response.status, body, "poll") };
      if (body?.task_status !== TASK_DONE) return { state: "running" };

      const resultUrl = resultUrlOf(body, endpoint);
      if (resultUrl === null) {
        return {
          state: "failed",
          failure: { code: "render_failed", transient: false, alert: false, detail: "task done but no result URL" },
        };
      }
      return { state: "done", resultUrl };
    },

    async download(url): Promise<DownloadResult> {
      if (!url.startsWith("https://")) return unusable("result URL is not https");

      let last = "";
      for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
        const tried = await downloadOnce(url);
        if (tried.ok || !tried.transient) return tried;
        last = tried.detail;
      }
      return {
        ok: false,
        detail: scrub(`download failed after ${String(DOWNLOAD_ATTEMPTS)} tries: ${last}`),
        transient: true,
      };
    },

    async credits(): Promise<number | null> {
      const response = await vendorFetch(
        http,
        { vendor: "ailabtools", step: "credits", timeoutMs: CREDITS_TIMEOUT_MS, codeOf: errorCodeOf },
        `${API_BASE_URL}${CREDITS_PATH}`,
        { headers: authorised },
      );
      if (response instanceof VendorUnreachable || !response.ok) return null;
      const answer = Credits.safeParse(await response.json().catch(() => null));
      if (!answer.success) return null;
      const pools = answer.data.data ?? [];
      return pools.reduce((total, pool) => total + pool.balance, 0);
    },
  };
}

/**
 * Each endpoint takes its own fields (3, 4); never one shared set.
 * Pro needs task_type, auto and image_size; image_size above 1 only returns
 * duplicates (7.12). Pro has no "keep the colour" and defaults to blonde, so
 * a colour is always sent (7.5).
 */
function submitForm(
  image: Uint8Array,
  type: "image/jpeg" | "image/png",
  preset: Preset,
  color: ProviderColor,
  endpoint: Endpoint,
): FormData {
  const form = new FormData();
  if (endpoint === "pro") {
    form.append("task_type", "async");
    form.append("auto", "1");
    form.append("image_size", "1");
  }
  form.append("hair_style", preset.hairStyle);
  form.append("color", color);
  // Premium checks the file name's extension, so it must match the bytes (7.2).
  form.append("image", new Blob([image], { type }), `portrait.${fileExtension(type)}`);
  return form;
}

/** A result no retry will make usable: too large for WhatsApp, or not an image at all. */
const unusable = (detail: string): DownloadResult => ({ ok: false, detail, transient: false });
/** A try the result host did not answer in full: worth another. */
const stalled = (detail: string): DownloadResult => ({ ok: false, detail, transient: true });

async function readBody(response: Response): Promise<ApiBody | null> {
  const answer = ApiBody.safeParse(await response.json().catch(() => null));
  return answer.success ? answer.data : null;
}

/** error_code is 0 (or absent) on success. */
function isSuccess(body: ApiBody | null): boolean {
  return body !== null && (body.error_code === undefined || Number(body.error_code) === 0);
}

/** Pro returns data.images[], Premium data.image (0). */
function resultUrlOf(body: ApiBody | null, endpoint: Endpoint): string | null {
  const result = ResultData.safeParse(body?.data);
  if (!result.success) return null;
  const { images, image } = result.data;
  const url = endpoint === "pro" && images !== undefined ? images[0] : image;
  return url === undefined || url === "" ? null : url;
}

/**
 * There is no published error-code table (5), so failures are classified by
 * HTTP status plus message. The error_code field usually repeats the status.
 */
function classify(httpStatus: number, body: ApiBody | null): Omit<RenderFailure, "detail"> {
  const codeAsStatus = Number(body?.error_code);
  const status = httpStatus < 400 && codeAsStatus >= 400 && codeAsStatus < 600 ? codeAsStatus : httpStatus;
  const text = JSON.stringify([body?.error_msg ?? "", body?.error_detail ?? ""]);

  // Premium reports a wrong file-name extension as an "internal error" (7.2). It is not an outage.
  if (status === 502 && /file type not supported/i.test(text)) return refused("photo_invalid_file");
  if (status === 422 && /only .*(png|jpe?g)/i.test(text)) return refused("photo_invalid_file");
  if (status === 401 || status === 403) return { code: "render_failed", transient: false, alert: true };
  if (status === 404 || text.includes("ERROR_AI_NOT_EXISTS"))
    return { code: "render_failed", transient: false, alert: true };
  if (/insufficient|balance|credit/i.test(text)) return { code: "render_failed", transient: false, alert: true };
  if (status === 429 || status >= 500) return { code: "render_failed", transient: true, alert: false };
  // Any other refusal is about the photo: no face, several faces, side-on, too small.
  if (status >= 400) return refused("photo_unreadable");
  return { code: "render_failed", transient: false, alert: false };
}

function refused(code: "photo_invalid_file" | "photo_unreadable"): Omit<RenderFailure, "detail"> {
  return { code, transient: false, alert: false };
}

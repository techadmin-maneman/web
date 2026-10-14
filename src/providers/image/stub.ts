// A fake YouCam API for local runs and tests. The real adapter (youcam.ts) talks to it through `fetch`, so the stub
// exercises the real request building and parsing. Response shapes follow docs/reference/youcam-api-notes.md.
//
// A test image picks a scenario by containing the text "mm-stub:<scenario>":
//   no-face         the task fails with error_no_face
//   no-shoulder     the task fails with error_no_shoulder
//   hair-too-short  the task fails with error_hair_too_short, which YouCam has never answered in our tests
//   inference       the task fails with error_inference, YouCam's own model failing
//   stall           the result host times out for a minute after the render, then answers
// Anything else renders successfully.

import { API_BASE_URL, CREDIT_PATH, FILE_PATH, TASK_PATH } from "./youcam.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { isOneOf } from "../../lib/one-of.ts";

export const STUB_API_KEY = "stub-youcam-key";
const STUB_UPLOAD_HOST = "https://stub-uploads.youcam.test";
const STUB_RESULT_HOST = "https://stub-results.youcam.test";

/** How long a stub render takes: about the 15 s measured, shortened. */
export const STUB_RENDER_MS = 6_000;
export const STUB_STALL_MS = MINUTE_MS;

const SCENARIOS = ["no-face", "no-shoulder", "hair-too-short", "inference", "stall"] as const;
type Scenario = (typeof SCENARIOS)[number] | "ok";

/** The task error each failing scenario answers with. */
const TASK_ERRORS: Partial<Record<Scenario, string>> = {
  "no-face": "error_no_face",
  "no-shoulder": "error_no_shoulder",
  "hair-too-short": "error_hair_too_short",
  inference: "error_inference",
};

/** A synthetic 1×1 grey PNG, standing in for a rendered result. */
export const STUB_RESULT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

export function createStubYoucamFetch(now: () => Date): typeof fetch {
  /** What each file ID's signed upload received, for the task that names it. */
  const uploads = new Map<string, Uint8Array>();
  let files = 0;

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.origin === STUB_UPLOAD_HOST) return upload(request, url, uploads);
    if (url.origin === STUB_RESULT_HOST) return download(request, url, now);
    if (url.origin !== API_BASE_URL) return json({ status: 404, error: "stub: unknown host" }, 404);
    if (request.headers.get("Authorization") !== `Bearer ${STUB_API_KEY}`) {
      return json({ status: 401, error: "Invalid access token", error_code: "InvalidAccessToken" }, 401);
    }

    if (request.method === "POST" && url.pathname === FILE_PATH) {
      files += 1;
      return uploadUrl(request, `stub-file-${String(files)}`);
    }
    if (request.method === "POST" && url.pathname === TASK_PATH) return startTask(request, uploads, now);
    if (request.method === "GET" && url.pathname.startsWith(`${TASK_PATH}/`)) return pollTask(url, now);
    if (request.method === "GET" && url.pathname === CREDIT_PATH) {
      return json({ status: 200, results: [{ amount_dec: 600.5 }, { amount_dec: 399.5 }] });
    }
    return json({ status: 404, error: "Not found", error_code: "NotFound" }, 404);
  };
}

async function uploadUrl(request: Request, fileId: string): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { files?: { content_type?: string }[] } | null;
  if (body?.files?.[0]?.content_type !== "image/jpg") {
    return json({ status: 400, error: "content_type must be image/jpg", error_code: "InvalidParameters" }, 400);
  }
  const requests = [{ method: "PUT", url: `${STUB_UPLOAD_HOST}/${fileId}`, headers: { "Content-Type": "image/jpg" } }];
  return json({ status: 200, data: { files: [{ file_id: fileId, requests }] } });
}

async function upload(request: Request, url: URL, uploads: Map<string, Uint8Array>): Promise<Response> {
  // A signed URL is refused a key, as storage refuses a second credential.
  if (request.method !== "PUT" || request.headers.has("Authorization")) return new Response("Bad request", { status: 400 });
  uploads.set(url.pathname.slice(1), new Uint8Array(await request.arrayBuffer()));
  return new Response(null, { status: 200 });
}

async function startTask(request: Request, uploads: Map<string, Uint8Array>, now: () => Date): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const image = uploads.get(String(body?.src_file_id ?? ""));
  const reference = String(body?.ref_file_url ?? "");
  if (image === undefined || !reference.startsWith("https://") || body?.hair_color !== "src") {
    return json({ status: 400, error: "Invalid parameters", error_code: "InvalidParameters" }, 400);
  }
  const taskId = `stub.${scenarioOf(image)}.${String(now().getTime())}`;
  return json({ status: 200, data: { task_id: taskId } });
}

function pollTask(url: URL, now: () => Date): Response {
  const taskId = decodeURIComponent(url.pathname.slice(TASK_PATH.length + 1));
  const task = parseTaskId(taskId);
  if (task === null) return json({ status: 404, error: "Task not found", error_code: "NotFound" }, 404);
  if (now().getTime() < task.startedAt + STUB_RENDER_MS) {
    return json({ status: 200, data: { task_status: "running" } });
  }
  const error = TASK_ERRORS[task.scenario];
  if (error !== undefined) {
    return json({ status: 200, data: { task_status: "error", error, error_message: `stub: ${error}` } });
  }
  const results = { url: `${STUB_RESULT_HOST}/${encodeURIComponent(taskId)}.png` };
  return json({ status: 200, data: { task_status: "success", results, error: null } });
}

function download(request: Request, url: URL, now: () => Date): Response {
  if (request.headers.has("Authorization")) return new Response("Bad request", { status: 400 });
  const task = parseTaskId(decodeURIComponent(url.pathname.slice(1).replace(/\.png$/, "")));
  if (task === null) return new Response("NoSuchKey", { status: 404 });
  if (task.scenario === "stall" && now().getTime() < task.startedAt + STUB_RENDER_MS + STUB_STALL_MS) {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }
  return new Response(STUB_RESULT_PNG, { headers: { "Content-Type": "image/png" } });
}

function scenarioOf(bytes: Uint8Array): Scenario {
  const head = bytes.subarray(0, 64 * 1024);
  return SCENARIOS.find((scenario) => contains(head, `mm-stub:${scenario}`)) ?? "ok";
}

function contains(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let start = 0; start + needle.length <= bytes.length; start++) {
    for (let index = 0; index < needle.length; index++) {
      if (bytes[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function parseTaskId(taskId: string): { scenario: Scenario; startedAt: number } | null {
  const [prefix, scenario, startedAt] = taskId.split(".");
  if (prefix !== "stub") return null;
  if (scenario !== "ok" && !isOneOf(SCENARIOS, scenario)) return null;
  return { scenario, startedAt: Number(startedAt) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

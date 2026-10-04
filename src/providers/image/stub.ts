// A fake AILabTools API for local runs and tests. The real adapter
// (ailabtools.ts) talks to it through `fetch`, so the stub exercises the real
// request building and parsing. Response shapes follow
// docs/reference/ailabtools-api-notes.md.
//
// A test image picks a scenario by containing the text "mm-stub:<scenario>":
//   refused-face   submit is refused with a 422, as for a photo with no usable face
//   file-type      Premium's misleading 502 "File type not supported" (7.2)
//   stall          the result host times out for a minute after the render, then answers (7.10)
// Anything else renders successfully.

import { API_BASE_URL, CREDITS_PATH, ENDPOINT_PATHS, POLL_PATH } from "./ailabtools.ts";
import { MINUTE_MS } from "../../lib/durations.ts";
import { isOneOf } from "../../lib/one-of.ts";

export const STUB_API_KEY = "stub-ailab-key";
export const STUB_RESULT_HOST = "https://ailab-outputs.oss-accelerate.aliyuncs.com";

/** How long a stub render takes: Pro renders faster than Premium, as measured (7.6), but shortened. */
export const STUB_RENDER_MS = { pro: 6_000, premium: 12_000 } as const;
export const STUB_STALL_MS = MINUTE_MS;

const SCENARIOS = ["refused-face", "file-type", "stall"] as const;
type Scenario = (typeof SCENARIOS)[number] | "ok";

/** A synthetic 1×1 grey PNG, standing in for a rendered result. */
export const STUB_RESULT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

export function createStubAilabtoolsFetch(now: () => Date): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.origin === STUB_RESULT_HOST) return download(url, now);
    if (url.origin !== API_BASE_URL) return json({ error: "stub: unknown host" }, 404);
    if (request.headers.get("ailabapi-api-key") !== STUB_API_KEY) {
      return json({ error_code: 401, error_msg: "Invalid API key" }, 401);
    }

    if (request.method === "POST" && url.pathname === ENDPOINT_PATHS.pro) return submit(request, "pro", now);
    if (request.method === "POST" && url.pathname === ENDPOINT_PATHS.premium) return submit(request, "premium", now);
    if (request.method === "GET" && url.pathname === POLL_PATH) return poll(url, now);
    if (request.method === "GET" && url.pathname === CREDITS_PATH) return credits();
    return json(
      { error_code: 404, error_msg: "AI does not exist or has been deactivated, please contact the platform." },
      404,
    );
  };
}

async function submit(request: Request, endpoint: "pro" | "premium", now: () => Date): Promise<Response> {
  const form = await request.formData();
  const image = form.get("image");
  if (!(image instanceof File) || form.get("hair_style") === null) {
    return error(400, "ERROR_PARAMETER", "Missing required parameter.");
  }
  if (endpoint === "pro" && (form.get("task_type") !== "async" || form.get("auto") !== "1")) {
    return error(400, "ERROR_PARAMETER", "task_type and auto are required.");
  }

  const scenario = scenarioOf(new Uint8Array(await image.arrayBuffer()));
  const extensionOk = /\.(jpe?g|png|webp)$/i.test(image.name);
  if (endpoint === "premium" && (scenario === "file-type" || !extensionOk)) {
    return error(502, "ERROR_AI_SERVICE", "AI service internal error ... - 500 - File type not supported");
  }
  if (scenario === "refused-face") {
    // The message is illustrative: AILabTools publishes no error-code table (section 5).
    return error(422, "ERROR_NO_FACE_IN_FILE", "No face detected in the image.");
  }

  const taskId = `stub.${scenario}.${endpoint}.${String(now().getTime())}`;
  const accepted = { request_id: "stub-request", log_id: "stub-log", task_id: taskId };
  // Pro's submit carries error_code and task_type; Premium's does not (sections 3 and 4).
  return json(endpoint === "pro" ? { ...accepted, error_code: 0, error_msg: "", task_type: "async" } : accepted);
}

function poll(url: URL, now: () => Date): Response {
  const task = parseTaskId(url.searchParams.get("task_id") ?? "");
  if (task === null) return error(400, "ERROR_TASK_NOT_FOUND", "Task not found.");

  if (now().getTime() < task.startedAt + STUB_RENDER_MS[task.endpoint]) {
    return json({ error_code: 0, error_msg: "", task_status: 1 });
  }
  const resultUrl = `${STUB_RESULT_HOST}/stub/${encodeURIComponent(url.searchParams.get("task_id") ?? "")}.png`;
  const data = task.endpoint === "pro" ? { images: [resultUrl] } : { image: resultUrl };
  return json({ error_code: 0, error_msg: "", task_status: 2, data });
}

function download(url: URL, now: () => Date): Response {
  const taskId = decodeURIComponent(url.pathname.replace(/^\/stub\//, "").replace(/\.png$/, ""));
  const task = parseTaskId(taskId);
  if (task === null) return new Response("NoSuchKey", { status: 404 });

  const renderedAt = task.startedAt + STUB_RENDER_MS[task.endpoint];
  if (task.scenario === "stall" && now().getTime() < renderedAt + STUB_STALL_MS) {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }
  return new Response(STUB_RESULT_PNG, { headers: { "Content-Type": "image/png" } });
}

function credits(): Response {
  const pool = (name: string, balance: number) => ({ unique_sign: name, name, balance, total: 2000 });
  return json({ error_code: 0, error_msg: "", data: [pool("stub-pool-a", 600.5), pool("stub-pool-b", 399.5)] });
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

function parseTaskId(taskId: string): { scenario: Scenario; endpoint: "pro" | "premium"; startedAt: number } | null {
  const [prefix, scenario, endpoint, startedAt] = taskId.split(".");
  if (prefix !== "stub" || (endpoint !== "pro" && endpoint !== "premium")) return null;
  if (scenario !== "ok" && !isOneOf(SCENARIOS, scenario)) return null;
  return { scenario, endpoint, startedAt: Number(startedAt) };
}

function error(status: number, code: string, message: string): Response {
  return json(
    {
      request_id: "stub-request",
      log_id: "stub-log",
      error_code: status,
      error_msg: message,
      error_detail: { status_code: status, code, code_message: message, message },
    },
    status,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

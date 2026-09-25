import { describe, expect, it } from "vitest";
import { PRESETS } from "../../src/config/presets.ts";
import { MAX_RESULT_BYTES } from "../../src/config/tryon.ts";
import { API_BASE_URL, ENDPOINT_PATHS, createAilabtoolsProvider } from "../../src/providers/ailabtools.ts";
import { STUB_RENDER_MS, STUB_RESULT_PNG, STUB_STALL_MS } from "../../src/providers/ailabtools-stub.ts";
import { createImageProvider } from "../../src/providers/image.ts";
import { NOW, fakeFetch, json } from "./helpers.ts";
import { syntheticJpeg, syntheticPng } from "./tryon-fixtures.ts";

const KEY = "live-key-that-must-never-leak";
const PRO_URL = `${API_BASE_URL}${ENDPOINT_PATHS.pro}`;
const PREMIUM_URL = `${API_BASE_URL}${ENDPOINT_PATHS.premium}`;
const POLL_URL = `${API_BASE_URL}/api/common/query-async-task-result`;
const CREDITS_URL = `${API_BASE_URL}/api/common/query-credits`;
const RESULT_URL = "https://ailab-outputs.oss-accelerate.aliyuncs.com/abc.png";
const preset = PRESETS[0];

function provider(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  return { image: createAilabtoolsProvider({ apiKey: KEY, fetch: http.fetch }), calls: http.calls };
}

/** The multipart fields of a recorded submit. */
async function formOf(call: { body: string; headers: Headers } | undefined) {
  const form = await new Response(call?.body, {
    headers: { "Content-Type": call?.headers.get("Content-Type") ?? "" },
  }).formData();
  const image = form.get("image");
  const fields = Object.fromEntries([...form.entries()].filter(([name]) => name !== "image"));
  return { fields, image: image instanceof File ? { name: image.name, type: image.type } : null };
}

const accepted = (taskId = "task-1") => json({ error_code: 0, task_id: taskId, task_type: "async" });

describe("AILabTools: submit", () => {
  it("builds Pro's form: async, auto, one image, the style, an explicit colour, a part named after its bytes", async () => {
    const { image, calls } = provider({ [PRO_URL]: () => accepted() });

    expect(await image.submit(syntheticJpeg(800, 800), preset, "black", "pro")).toEqual({ ok: true, taskId: "task-1" });

    expect(calls[0]?.headers.get("ailabapi-api-key")).toBe(KEY);
    expect(await formOf(calls[0])).toEqual({
      fields: { task_type: "async", auto: "1", image_size: "1", hair_style: "Natural_Side-Part", color: "black" },
      image: { name: "portrait.jpg", type: "image/jpeg" },
    });
  });

  it("builds Premium's form with none of Pro's fields, naming a PNG part .png", async () => {
    const { image, calls } = provider({ [PREMIUM_URL]: () => json({ request_id: "r", task_id: "task-2" }) });

    expect(await image.submit(syntheticPng(800, 800), preset, "original", "premium")).toEqual({
      ok: true,
      taskId: "task-2",
    });
    expect(await formOf(calls[0])).toEqual({
      fields: { hair_style: "Natural_Side-Part", color: "original" },
      image: { name: "portrait.png", type: "image/png" },
    });
  });

  it("refuses to send anything that is not a JPEG or PNG", async () => {
    const { image, calls } = provider({});
    const result = await image.submit(new TextEncoder().encode("GIF89a"), preset, "black", "pro");
    expect(result).toMatchObject({ ok: false, failure: { code: "photo_invalid_file", transient: false } });
    expect(calls).toEqual([]);
  });

  it.each([
    [
      "Premium's 502 file-type trap",
      502,
      { error_msg: "AI service internal error ... - 500 - File type not supported" },
      { code: "photo_invalid_file", transient: false, alert: false },
    ],
    [
      "a format refusal",
      422,
      { error_msg: "Only PNG, JPG, JPEG are supported." },
      { code: "photo_invalid_file", transient: false, alert: false },
    ],
    [
      "a face it cannot use",
      422,
      { error_detail: { code: "ERROR_NO_FACE", message: "No face detected" } },
      { code: "photo_unreadable", transient: false, alert: false },
    ],
    ["a refused key", 401, { error_msg: "Invalid API key" }, { code: "render_failed", transient: false, alert: true }],
    [
      "the dead endpoint",
      404,
      { error_detail: { code: "ERROR_AI_NOT_EXISTS" } },
      { code: "render_failed", transient: false, alert: true },
    ],
    [
      "an empty balance",
      400,
      { error_msg: "Insufficient balance" },
      { code: "render_failed", transient: false, alert: true },
    ],
    ["a rate limit", 429, {}, { code: "render_failed", transient: true, alert: false }],
    ["an outage", 503, {}, { code: "render_failed", transient: true, alert: false }],
  ])("classifies %s", async (_label, status, body, expected) => {
    const { image } = provider({ [PREMIUM_URL]: () => json({ error_code: status, ...body }, status) });
    const result = await image.submit(syntheticJpeg(800, 800), preset, "original", "premium");
    expect(result.ok ? null : result.failure).toMatchObject(expected);
  });

  it("classifies an error reported inside a 200 by its error_code", async () => {
    const { image } = provider({ [PRO_URL]: () => json({ error_code: 422, error_msg: "Face too small" }) });
    const result = await image.submit(syntheticJpeg(800, 800), preset, "black", "pro");
    expect(result.ok ? null : result.failure.code).toBe("photo_unreadable");
  });

  it("treats an unreachable API as transient, and never puts the key in the detail", async () => {
    const { image } = provider({
      [PRO_URL]: () => {
        throw new TypeError(`connection reset while sending ${KEY}`);
      },
    });
    const result = await image.submit(syntheticJpeg(800, 800), preset, "black", "pro");
    expect(result).toMatchObject({ ok: false, failure: { code: "render_failed", transient: true } });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).toContain("***REDACTED***");
  });
});

describe("AILabTools: poll", () => {
  it("reads Pro's data.images[0] and Premium's data.image once task_status is 2", async () => {
    const done = { error_code: 0, task_status: 2 };
    const pro = provider({ [POLL_URL]: () => json({ ...done, data: { images: [RESULT_URL, "dup"] } }) });
    expect(await pro.image.poll("t", "pro")).toEqual({ state: "done", resultUrl: RESULT_URL });
    expect(pro.calls[0]?.url).toBe(`${POLL_URL}?task_id=t`);

    const premium = provider({ [POLL_URL]: () => json({ ...done, data: { image: RESULT_URL } }) });
    expect(await premium.image.poll("t", "premium")).toEqual({ state: "done", resultUrl: RESULT_URL });
  });

  it("is still running at task_status 0 or 1", async () => {
    const { image } = provider({ [POLL_URL]: () => json({ error_code: 0, task_status: 1 }) });
    expect(await image.poll("t", "pro")).toEqual({ state: "running" });
  });

  it("fails on an error code, on a finished task without a URL, and transiently when unreachable", async () => {
    const refused = provider({ [POLL_URL]: () => json({ error_code: 422, error_msg: "No face detected" }) });
    expect(await refused.image.poll("t", "pro")).toMatchObject({
      state: "failed",
      failure: { code: "photo_unreadable" },
    });

    const empty = provider({ [POLL_URL]: () => json({ error_code: 0, task_status: 2, data: {} }) });
    expect(await empty.image.poll("t", "premium")).toMatchObject({
      state: "failed",
      failure: { code: "render_failed" },
    });

    const down = provider({
      [POLL_URL]: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.image.poll("t", "pro")).toMatchObject({ state: "failed", failure: { transient: true } });
  });
});

describe("AILabTools: download", () => {
  it("fetches without the API key and labels the bytes by what they are", async () => {
    const { image, calls } = provider({
      [RESULT_URL]: () => new Response(STUB_RESULT_PNG, { headers: { "Content-Type": "image/jpeg" } }),
    });
    const result = await image.download(RESULT_URL);
    expect(result).toMatchObject({ ok: true, contentType: "image/png" });
    expect(calls[0]?.headers.has("ailabapi-api-key")).toBe(false);
  });

  it("tries three times before giving up on a stalled host, and refuses non-https or non-image results", async () => {
    let tries = 0;
    const stalled = provider({
      [RESULT_URL]: () => {
        tries++;
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    expect(await stalled.image.download(RESULT_URL)).toEqual({
      ok: false,
      detail: "download failed after 3 tries: TimeoutError",
      transient: true,
    });
    expect(tries).toBe(3);

    let attempts = 0;
    const flaky = provider({
      [RESULT_URL]: () => (++attempts < 3 ? new Response("busy", { status: 503 }) : new Response(STUB_RESULT_PNG)),
    });
    expect(await flaky.image.download(RESULT_URL)).toMatchObject({ ok: true });

    expect(await provider({}).image.download("http://insecure.test/x.png")).toMatchObject({
      ok: false,
      transient: false,
    });
    const html = provider({ [RESULT_URL]: () => new Response("<html>") });
    expect(await html.image.download(RESULT_URL)).toEqual({
      ok: false,
      detail: "result is not a JPEG or PNG",
      transient: false,
    });
  });

  it("refuses a result over WhatsApp's 5 MB at once, by its declared length before reading it", async () => {
    expect(MAX_RESULT_BYTES).toBe(5 * 1024 * 1024);
    let read = false;
    const declared = provider({
      [RESULT_URL]: () =>
        new Response(
          new ReadableStream(
            {
              pull() {
                read = true;
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { "Content-Length": String(MAX_RESULT_BYTES + 1) } },
        ),
    });
    expect(await declared.image.download(RESULT_URL)).toEqual({
      ok: false,
      detail: `result is ${String(MAX_RESULT_BYTES + 1)} bytes`,
      transient: false,
    });
    expect(read).toBe(false);
    expect(declared.calls).toHaveLength(1);

    // A host that declares nothing is measured once the body is in; it is not asked again.
    const undeclared = provider({ [RESULT_URL]: () => new Response(new Uint8Array(MAX_RESULT_BYTES + 1)) });
    expect(await undeclared.image.download(RESULT_URL)).toMatchObject({ ok: false, transient: false });
    expect(undeclared.calls).toHaveLength(1);
  });
});

describe("AILabTools: credits", () => {
  it("sums every pool, and accepts a single pool object", async () => {
    const pools = provider({ [CREDITS_URL]: () => json({ data: [{ balance: 120.5 }, { balance: "30" }, {}] }) });
    expect(await pools.image.credits()).toBe(150.5);
    const single = provider({ [CREDITS_URL]: () => json({ data: { balance: 42 } }) });
    expect(await single.image.credits()).toBe(42);
  });

  it("returns null when the balance cannot be read", async () => {
    expect(await provider({ [CREDITS_URL]: () => json({}, 500) }).image.credits()).toBeNull();
    const down = provider({
      [CREDITS_URL]: () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.image.credits()).toBeNull();
  });
});

describe("the stub AILabTools", () => {
  const at = (ms: number) => () => new Date(NOW.getTime() + ms);

  it("renders through the real adapter: submit, running, then done, and serves a PNG", async () => {
    let now = at(0);
    const image = createImageProvider(null, { fetch, now: () => now() });
    const submitted = await image.submit(syntheticJpeg(800, 800), preset, "black", "pro");
    if (!submitted.ok) throw new Error("stub refused the submit");

    expect(await image.poll(submitted.taskId, "pro")).toEqual({ state: "running" });
    now = at(STUB_RENDER_MS.pro);
    const done = await image.poll(submitted.taskId, "pro");
    if (done.state !== "done") throw new Error("stub did not finish");
    expect(await image.download(done.resultUrl)).toMatchObject({ ok: true, contentType: "image/png" });
    expect(await image.credits()).toBe(1000);
  });

  it("replays the documented failures: a refused face, Premium's 502 trap, and a stalled download", async () => {
    const image = createImageProvider(null, { fetch, now: at(0) });
    const face = await image.submit(syntheticJpeg(800, 800, "mm-stub:refused-face"), preset, "black", "pro");
    expect(face.ok ? null : face.failure.code).toBe("photo_unreadable");

    const trap = await image.submit(syntheticJpeg(800, 800, "mm-stub:file-type"), preset, "original", "premium");
    expect(trap.ok ? null : trap.failure.code).toBe("photo_invalid_file");

    let now = at(0);
    const stalling = createImageProvider(null, { fetch, now: () => now() });
    const submitted = await stalling.submit(syntheticJpeg(800, 800, "mm-stub:stall"), preset, "black", "pro");
    if (!submitted.ok) throw new Error("stub refused the submit");
    now = at(STUB_RENDER_MS.pro);
    const done = await stalling.poll(submitted.taskId, "pro");
    if (done.state !== "done") throw new Error("stub did not finish");
    expect(await stalling.download(done.resultUrl)).toMatchObject({ ok: false });
    now = at(STUB_RENDER_MS.pro + STUB_STALL_MS);
    expect(await stalling.download(done.resultUrl)).toMatchObject({ ok: true });
  });
});

// YouCam's adapter (src/providers/image/youcam.ts) against mocked answers: what each of YouCam's codes becomes, that
// the key reaches YouCam's API host and nothing else, and how the units are read. Every name and number is made up.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import {
  API_BASE_URL,
  CREDIT_PATH,
  FILE_PATH,
  TASK_PATH,
  classifyHttpError,
  classifyTaskError,
  createYoucamProvider,
} from "../../../src/providers/image/youcam.ts";
import { fakeFetch, json } from "../helpers.ts";
import { syntheticJpeg, syntheticPng } from "../tryon-fixtures.ts";

const KEY = "live-key-that-must-never-leak";
const UPLOAD_URL = "https://storage.youcam.test/upload/f1?signature=abc";
const RESULT_URL = "https://results.youcam.test/r1.jpg";
const REFERENCE = "https://maneman.in/refs/v1/side-part.jpg";
const log = createLogger();

const uploadUrl = () =>
  json({
    status: 200,
    data: {
      files: [
        { file_id: "f1", requests: [{ method: "PUT", url: UPLOAD_URL, headers: { "Content-Type": "image/jpg" } }] },
      ],
    },
  });

/** YouCam answering the upload and the task, then each poll with `polled`. */
function youcam(polled: () => Response = () => json({ status: 200, data: { task_status: "running" } })) {
  const http = fakeFetch({
    [`${API_BASE_URL}${FILE_PATH}`]: uploadUrl,
    [UPLOAD_URL]: () => new Response(null, { status: 200 }),
    [`${API_BASE_URL}${TASK_PATH}`]: (call) =>
      call.method === "POST" ? json({ status: 200, data: { task_id: "t1" } }) : polled(),
    [RESULT_URL]: () => new Response(syntheticJpeg(64, 64), { headers: { "Content-Type": "image/jpeg" } }),
  });
  return { image: createYoucamProvider({ apiKey: KEY, fetch: http.fetch, log }), calls: http.calls };
}

/** A poll's answer for a task YouCam failed with `code`. */
const taskError = (code: string) =>
  json({ status: 200, data: { task_status: "error", error: code, error_message: "stub" } });

describe("YouCam: a render", () => {
  it("uploads the photograph through the signed URL, without the key, and asks for the look's hair in its own colour", async () => {
    const { image, calls } = youcam();
    expect(await image.submit(syntheticJpeg(800, 800), REFERENCE)).toEqual({ ok: true, taskId: "t1" });

    const [asked, put, task] = calls;
    expect(asked?.headers.get("Authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(asked?.body ?? "")).toEqual({
      files: [{ content_type: "image/jpg", file_name: "selfie.jpg", file_size: syntheticJpeg(800, 800).byteLength }],
    });
    expect(put).toMatchObject({ method: "PUT", url: UPLOAD_URL });
    expect(put?.headers.get("Authorization")).toBeNull();
    expect(put?.headers.get("Content-Type")).toBe("image/jpg");
    expect(JSON.parse(task?.body ?? "")).toEqual({ src_file_id: "f1", ref_file_url: REFERENCE, hair_color: "src" });
  });

  it("refuses a photograph that is not a JPEG before calling, as a fault of ours", async () => {
    const { image, calls } = youcam();
    expect(await image.submit(syntheticPng(800, 800), REFERENCE)).toMatchObject({
      ok: false,
      failure: { code: "photo_invalid_file", alert: true },
    });
    expect(calls).toEqual([]);
  });

  it("reads a running task, a finished one's result, and downloads it without the key", async () => {
    expect(await youcam().image.poll("t1")).toEqual({ state: "running" });
    const done = youcam(() => json({ status: 200, data: { task_status: "success", results: { url: RESULT_URL } } }));
    expect(await done.image.poll("t1")).toEqual({ state: "done", resultUrl: RESULT_URL });
    expect(await done.image.download(RESULT_URL)).toMatchObject({ ok: true, contentType: "image/jpeg" });
    expect(done.calls.at(-1)?.headers.get("Authorization")).toBeNull();
  });

  it("keeps YouCam's code verbatim in the detail, and never the key", async () => {
    const { image } = youcam(() => taskError("error_no_shoulder"));
    const polled = await image.poll("t1");
    expect(polled).toMatchObject({ state: "failed", failure: { reason: "no_shoulders" } });
    const detail = polled.state === "failed" ? polled.failure.detail : "";
    expect(detail).toContain("error_no_shoulder");
    expect(detail).not.toContain(KEY);
  });
});

describe("YouCam: what each refusal becomes", () => {
  it.each([
    ["error_no_shoulder", "no_shoulders"],
    ["error_large_face_angle", "face_angle"],
    ["error_face_pose", "face_angle"],
    ["error_pose", "face_angle"],
    ["error_no_face", "no_face"],
    ["error_insufficient_landmarks", "no_face"],
    ["error_multiple_people", "several_people"],
    ["error_nsfw_content_detected", "refused"],
  ] as const)("tells the visitor of %s as %s, and nobody else", (code, reason) => {
    expect(classifyTaskError(code)).toEqual({ code: "photo_unreadable", reason, transient: false, alert: false });
  });

  it.each(["error_hair_too_short", "error_bald_image"])(
    "tells ops loudly of %s: it would turn away our clients",
    (code) => {
      expect(classifyTaskError(code)).toEqual({
        code: "photo_unreadable",
        reason: "not_styleable",
        transient: false,
        alert: true,
      });
    },
  );

  it.each(["exceed_max_filesize", "error_exceed_max_image_size", "error_decode_image", "error_unsupport_ratio"])(
    "takes %s for a fault in our preparation, for engineering",
    (code) => {
      expect(classifyTaskError(code)).toEqual({ code: "render_failed", transient: false, alert: true });
    },
  );

  it.each(["error_inference", "unknown_internal_error"])("makes the render once more after %s", (code) => {
    expect(classifyTaskError(code)).toEqual({ code: "render_failed", transient: false, retryOnce: true, alert: false });
  });

  it("pages ops, as paused, when YouCam refuses the key or is out of units", () => {
    const paused = { code: "render_failed", reason: "unavailable", transient: false, alert: true };
    for (const code of ["InvalidAccessToken", "InvalidApiKey", "InactiveApiKey", "ExpiredApiKey"]) {
      expect(classifyHttpError(401, code)).toEqual({ ...paused, urgentKey: "tryon_paused:key" });
    }
    expect(classifyHttpError(400, "CreditInsufficiency")).toEqual({ ...paused, urgentKey: "tryon_paused:credits" });
  });

  it("tries again after a 429 or a 5xx, and takes any other refusal for a request of ours to fix", () => {
    expect(classifyHttpError(429, null)).toEqual({ code: "render_failed", transient: true, alert: false });
    expect(classifyHttpError(503, null)).toEqual({ code: "render_failed", transient: true, alert: false });
    expect(classifyHttpError(400, "InvalidParameters")).toEqual({
      code: "render_failed",
      transient: false,
      alert: true,
    });
    expect(classifyHttpError(400, "error_no_face")).toMatchObject({ code: "photo_unreadable", reason: "no_face" });
  });
});

describe("YouCam: the units left", () => {
  it("sums every pool, wherever the answer keeps them", async () => {
    const credit = (body: unknown) =>
      createYoucamProvider({
        apiKey: KEY,
        fetch: fakeFetch({ [`${API_BASE_URL}${CREDIT_PATH}`]: () => json(body) }).fetch,
        log,
      }).credits();
    expect(await credit({ status: 200, results: [{ amount_dec: 600.5 }, { amount_dec: 399.5 }] })).toBe(1000);
    expect(await credit({ status: 200, data: { results: [{ amount_dec: "12" }] } })).toBe(12);
    expect(await credit({ status: 200 })).toBe(0);
  });
});

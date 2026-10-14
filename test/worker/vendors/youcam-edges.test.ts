// YouCam's adapter at its edges (src/providers/image/youcam.ts), and the stub that fakes it for local runs and tests
// (src/providers/image/stub.ts): every way a call can fail, and what each becomes. Every name and number is made up.

import { describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createImageProvider } from "../../../src/providers/image/index.ts";
import { STUB_API_KEY, createStubYoucamFetch } from "../../../src/providers/image/stub.ts";
import {
  API_BASE_URL,
  CREDIT_PATH,
  FILE_PATH,
  TASK_PATH,
  createYoucamProvider,
} from "../../../src/providers/image/youcam.ts";
import { fakeFetch, json, NOW } from "../helpers.ts";
import { syntheticJpeg } from "../tryon-fixtures.ts";

const KEY = "live-key-that-must-never-leak";
const UPLOAD_URL = "https://storage.youcam.test/upload/f1";
const REFERENCE = "https://maneman.in/refs/v1/side-part.jpg";
const log = createLogger();
const photo = syntheticJpeg(800, 800);

const uploadUrl = () =>
  json({
    status: 200,
    data: { files: [{ file_id: "f1", requests: [{ method: "PUT", url: UPLOAD_URL, headers: {} }] }] },
  });

const youcam = (routes: Parameters<typeof fakeFetch>[0]) =>
  createYoucamProvider({ apiKey: KEY, fetch: fakeFetch(routes).fetch, log });

const unreachable = () => Promise.reject(new TypeError("fetch failed"));

describe("YouCam: an upload that does not go through", () => {
  it("pages ops when the upload URL is refused for the key, and tells a missing file list from it", async () => {
    const refused = youcam({
      [`${API_BASE_URL}${FILE_PATH}`]: () => json({ status: 401, error_code: "InvalidApiKey" }, 401),
    });
    expect(await refused.submit(photo, REFERENCE)).toMatchObject({
      ok: false,
      failure: { reason: "unavailable", urgentKey: "tryon_paused:key" },
    });
    const empty = youcam({ [`${API_BASE_URL}${FILE_PATH}`]: () => json({ status: 200, data: { files: [] } }) });
    expect(await empty.submit(photo, REFERENCE)).toMatchObject({ ok: false, failure: { code: "render_failed" } });
  });

  it("tries again after storage stalls or fails, and takes any other refusal for a fault of ours", async () => {
    const put = (answer: () => Response | Promise<Response>) =>
      youcam({ [`${API_BASE_URL}${FILE_PATH}`]: uploadUrl, [UPLOAD_URL]: answer }).submit(photo, REFERENCE);
    expect(await put(() => new Response(null, { status: 503 }))).toMatchObject({
      ok: false,
      failure: { transient: true, alert: false, detail: "signed upload refused: HTTP 503" },
    });
    expect(await put(() => new Response(null, { status: 403 }))).toMatchObject({
      ok: false,
      failure: { transient: false, alert: true },
    });
    expect(await put(unreachable)).toMatchObject({ ok: false, failure: { transient: true } });
  });

  it("tries again when YouCam cannot be reached at all", async () => {
    const image = createYoucamProvider({ apiKey: KEY, fetch: unreachable, log });
    expect(await image.submit(photo, REFERENCE)).toMatchObject({ ok: false, failure: { transient: true } });
    expect(await image.poll("t1")).toMatchObject({ state: "failed", failure: { transient: true } });
  });

  it("fails a task YouCam answers with no ID", async () => {
    const image = youcam({
      [`${API_BASE_URL}${FILE_PATH}`]: uploadUrl,
      [UPLOAD_URL]: () => new Response(null, { status: 200 }),
      [`${API_BASE_URL}${TASK_PATH}`]: () => json({ status: 200, data: {} }),
    });
    expect(await image.submit(photo, REFERENCE)).toMatchObject({ ok: false, failure: { code: "render_failed" } });
  });
});

describe("YouCam: a poll that does not end well", () => {
  const polled = (answer: () => Response) => youcam({ [`${API_BASE_URL}${TASK_PATH}`]: answer }).poll("t1");

  it("tries again over the rate, and alerts on a success with no image", async () => {
    expect(await polled(() => json({ status: 429 }, 429))).toMatchObject({
      state: "failed",
      failure: { transient: true },
    });
    expect(await polled(() => json({ status: 200, data: { task_status: "success", results: {} } }))).toMatchObject({
      state: "failed",
      failure: { alert: true, detail: "task succeeded with no result URL" },
    });
  });

  it("takes a result given as a list, and an error with no code as a fault to look at", async () => {
    const url = "https://results.youcam.test/r1.jpg";
    expect(await polled(() => json({ status: 200, data: { task_status: "success", results: [{ url }] } }))).toEqual({
      state: "done",
      resultUrl: url,
    });
    expect(await polled(() => json({ status: 200, data: { task_status: "error" } }))).toMatchObject({
      state: "failed",
      failure: { code: "render_failed", alert: true },
    });
  });

  it("answers no units where the balance cannot be read", async () => {
    const credit = (answer: () => Response) => youcam({ [`${API_BASE_URL}${CREDIT_PATH}`]: answer }).credits();
    expect(await credit(() => json({ status: 500 }, 500))).toBeNull();
    expect(await credit(() => new Response("not json"))).toBeNull();
    expect(await credit(() => json({ status: 200, results: "none" }))).toBeNull();
  });
});

describe("the image provider chosen", () => {
  it("is YouCam itself with a key, and the stub without", async () => {
    const http = fakeFetch({
      [`${API_BASE_URL}${CREDIT_PATH}`]: () => json({ status: 200, results: [{ amount_dec: 7 }] }),
    });
    expect(await createImageProvider("k", { fetch: http.fetch, now: () => NOW, log }).credits()).toBe(7);
    expect(http.calls[0]?.headers.get("Authorization")).toBe("Bearer k");
    expect(await createImageProvider(null, { fetch: unreachable, now: () => NOW, log }).credits()).toBe(1000);
  });
});

describe("the stub", () => {
  const stub = createStubYoucamFetch(() => NOW);
  const call = (path: string, init: RequestInit = {}, key = STUB_API_KEY) =>
    stub(`${API_BASE_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${key}` } });

  it("refuses an unknown host, a wrong key and a call it does not know", async () => {
    expect((await stub("https://elsewhere.test/")).status).toBe(404);
    expect((await call(CREDIT_PATH, {}, "wrong")).status).toBe(401);
    expect((await call("/s2s/v9/nothing")).status).toBe(404);
  });

  it("refuses an upload of anything but a JPEG, and a signed upload sent the key", async () => {
    const png = { files: [{ content_type: "image/png", file_name: "a.png", file_size: 1 }] };
    expect((await call(FILE_PATH, { method: "POST", body: JSON.stringify(png) })).status).toBe(400);
    const jpg = { files: [{ content_type: "image/jpg", file_name: "a.jpg", file_size: 1 }] };
    const asked = await call(FILE_PATH, { method: "POST", body: JSON.stringify(jpg) });
    const { data } = await asked.json<{ data: { files: { requests: { url: string }[] }[] } }>();
    const url = data.files[0]?.requests[0]?.url ?? "";
    expect((await stub(url, { method: "PUT", headers: { Authorization: "Bearer x" }, body: "x" })).status).toBe(400);
  });

  it("refuses a task for a file it never took, and knows no task or result it never made", async () => {
    const task = { src_file_id: "never", ref_file_url: REFERENCE, hair_color: "src" };
    expect((await call(TASK_PATH, { method: "POST", body: JSON.stringify(task) })).status).toBe(400);
    expect((await call(`${TASK_PATH}/nobody.ok.1`)).status).toBe(404);
    expect((await stub("https://stub-results.youcam.test/nobody.png")).status).toBe(404);
    expect(
      (await stub("https://stub-results.youcam.test/x.png", { headers: { Authorization: "Bearer x" } })).status,
    ).toBe(400);
  });
});

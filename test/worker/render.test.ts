import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/log.ts";
import { STUB_RENDER_MS, STUB_STALL_MS } from "../../src/providers/image/stub.ts";
import { createImageProvider, type ImageProvider } from "../../src/providers/image/index.ts";
import {
  POLL_DELAY_SECONDS,
  RENDER_GIVE_UP_MS,
  RESULT_URL_LIFETIME_MS,
  SUBMIT_ATTEMPTS,
} from "../../src/config/pipeline.ts";
import { advanceJob, handleRenderBatch, type RenderEnv } from "../../src/queues/render.ts";
import { NOW, captureLogs, fakeDependencies, fakeQueue, markDatabase } from "./helpers.ts";
import { insertJob, insertPerson, syntheticJpeg } from "./tryon-fixtures.ts";

const OPTIONS = { resultRetentionDays: 30 };
const log = createLogger();

/** A clock the test moves by hand, shared by the job code and the stub provider. */
function clock() {
  let ms = NOW.getTime();
  return { now: () => new Date(ms), advance: (by: number) => (ms += by) };
}

/** The stub provider, counting how often it was asked to submit. */
function countingImage(now: () => Date) {
  const image = createImageProvider(null, { fetch, now, log });
  const submit = vi.fn(image.submit.bind(image));
  return { image: { ...image, submit } satisfies ImageProvider, submit };
}

async function queuedJob(
  id: string,
  options: { endpoint?: "pro" | "premium"; color?: string; marker?: string } = {},
): Promise<void> {
  await insertJob({
    id,
    state: "queued",
    stage: "crown",
    preset: "full-natural-short",
    hair_color: "black",
    endpoint: options.endpoint ?? "pro",
    provider_color: options.color ?? "black",
    color_route: "as_detected",
    uploaded_at: NOW.toISOString(),
  });
  await env.UPLOADS.put(`uploads/${id}`, syntheticJpeg(800, 800, options.marker ?? ""));
}

function job(id: string) {
  return env.DB.prepare(
    `SELECT state, failure_code, provider_task_id, provider_result_url, result_key, latency_ms, download_attempts,
            provider_error_detail, expires_at
     FROM tryon_jobs WHERE id = ?`,
  )
    .bind(id)
    .first();
}

function renderEnv(): RenderEnv & { MESSAGE_QUEUE: ReturnType<typeof fakeQueue> } {
  return { DB: env.DB, UPLOADS: env.UPLOADS, RESULTS: env.RESULTS, MESSAGE_QUEUE: fakeQueue() };
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("render: the happy path", () => {
  it("submits a Pro job, polls on a delayed retry, downloads and records the latency", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    const bindings = renderEnv();
    await queuedJob("pro-job");

    expect(await advanceJob(bindings, deps, log, "pro-job", OPTIONS)).toEqual({
      retryAfterSeconds: POLL_DELAY_SECONDS.early,
    });
    expect(await job("pro-job")).toMatchObject({
      state: "rendering",
      provider_task_id: expect.stringMatching(/^stub\./) as string,
    });

    time.advance(3_000);
    expect(await advanceJob(bindings, deps, log, "pro-job", OPTIONS)).toEqual({
      retryAfterSeconds: POLL_DELAY_SECONDS.early,
    });

    time.advance(STUB_RENDER_MS.pro);
    expect(await advanceJob(bindings, deps, log, "pro-job", OPTIONS)).toEqual({});

    const done = await job("pro-job");
    expect(done).toMatchObject({
      state: "ready",
      result_key: "results/pro-job.png",
      latency_ms: 3_000 + STUB_RENDER_MS.pro,
    });
    expect(done?.provider_result_url).toMatch(/^https:\/\/ailab-outputs\./);
    expect((await env.RESULTS.head("results/pro-job.png"))?.httpMetadata?.contentType).toBe("image/png");
    expect(submit).toHaveBeenCalledOnce();
  });

  // REQ-S2-03: nothing checked the date a result is deleted by, so a slip could keep one past what the notice promises.
  it("keeps a ready result for the retention days set, counted from the moment it is ready and no longer", async () => {
    for (const [id, days] of [
      ["kept-3", 3],
      ["kept-30", 30],
    ] as const) {
      const time = clock();
      const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
      await queuedJob(id);
      await advanceJob(renderEnv(), deps, log, id, { resultRetentionDays: days });
      time.advance(STUB_RENDER_MS.pro);
      await advanceJob(renderEnv(), deps, log, id, { resultRetentionDays: days });

      const ready = await job(id);
      expect(ready?.state).toBe("ready");
      expect(ready?.expires_at).toBe(new Date(time.now().getTime() + days * 24 * 60 * 60 * 1000).toISOString());
    }
  });

  it("renders a Premium job with color=original", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("premium-job", { endpoint: "premium", color: "original" });

    await advanceJob(renderEnv(), deps, log, "premium-job", OPTIONS);
    time.advance(STUB_RENDER_MS.premium);
    await advanceJob(renderEnv(), deps, log, "premium-job", OPTIONS);

    expect(await job("premium-job")).toMatchObject({ state: "ready", latency_ms: STUB_RENDER_MS.premium });
    expect(submit.mock.calls[0]?.slice(2)).toEqual(["original", "premium"]);
  });

  it("slows polling to every 10 s after the first 30 s", async () => {
    const time = clock();
    const slow: ImageProvider = { ...countingImage(time.now).image, poll: () => Promise.resolve({ state: "running" }) };
    const deps = fakeDependencies({ now: time.now, image: slow });
    await queuedJob("slow");
    await advanceJob(renderEnv(), deps, log, "slow", OPTIONS);

    time.advance(31_000);
    expect(await advanceJob(renderEnv(), deps, log, "slow", OPTIONS)).toEqual({
      retryAfterSeconds: POLL_DELAY_SECONDS.late,
    });
  });

  it("queues the result message a gate left waiting, and enqueues it", async () => {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    const bindings = renderEnv();
    await queuedJob("gated");
    await insertPerson("p", "+919810000001");
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
       VALUES ('m1', ?, 'p', 'tryon_result', 'gated', 'waiting')`,
    )
      .bind(NOW.toISOString())
      .run();

    await advanceJob(bindings, deps, log, "gated", OPTIONS);
    time.advance(STUB_RENDER_MS.pro);
    await advanceJob(bindings, deps, log, "gated", OPTIONS);

    const message = await env.DB.prepare("SELECT state, queued_at FROM outbound_messages WHERE id = 'm1'").first();
    expect(message).toEqual({ state: "queued", queued_at: time.now().toISOString() });
    expect(bindings.MESSAGE_QUEUE.sent).toEqual([{ message_id: "m1", request_id: "request" }]);
  });
});

describe("render: never billed twice", () => {
  it("submits once, however often the queued message is delivered", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("twice");
    // The job is claimed before submitting; a second delivery that arrives meanwhile finds it taken.
    await env.DB.prepare("UPDATE tryon_jobs SET submit_started_at = ? WHERE id = 'twice'")
      .bind(NOW.toISOString())
      .run();

    expect(await advanceJob(renderEnv(), deps, log, "twice", OPTIONS)).toEqual({});
    expect(submit).not.toHaveBeenCalled();
  });

  it("recovers a stalled download from the stored URL, without a second render", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("stalled", { marker: "mm-stub:stall" });

    await advanceJob(renderEnv(), deps, log, "stalled", OPTIONS);
    time.advance(STUB_RENDER_MS.pro);
    expect(await advanceJob(renderEnv(), deps, log, "stalled", OPTIONS)).toEqual({ retryAfterSeconds: 60 });
    const waiting = await job("stalled");
    expect(waiting).toMatchObject({ state: "downloading", download_attempts: 1 });
    expect(waiting?.provider_result_url).toMatch(/^https:/);

    time.advance(STUB_STALL_MS);
    expect(await advanceJob(renderEnv(), deps, log, "stalled", OPTIONS)).toEqual({});
    expect(await job("stalled")).toMatchObject({ state: "ready", download_attempts: 2 });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("leaves a download to the sweeper after three quick tries, and fails with an alert once the URL expires", async () => {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    await queuedJob("lost", { marker: "mm-stub:stall" });
    await advanceJob(renderEnv(), deps, log, "lost", OPTIONS);
    time.advance(STUB_RENDER_MS.pro);
    await advanceJob(renderEnv(), deps, log, "lost", OPTIONS); // attempt 1
    await advanceJob(renderEnv(), deps, log, "lost", OPTIONS); // attempt 2
    expect(await advanceJob(renderEnv(), deps, log, "lost", OPTIONS)).toEqual({}); // attempt 3: the sweeper takes over

    time.advance(RESULT_URL_LIFETIME_MS);
    await advanceJob(renderEnv(), deps, log, "lost", OPTIONS);
    expect(await job("lost")).toMatchObject({ state: "failed", failure_code: "render_failed" });
    expect(deps.alerts).toEqual([expect.stringContaining("a billed image is lost") as string]);
  });
});

describe("render: a result that can never be used", () => {
  it("fails at once with render_failed and an alert, rather than downloading it again for a day", async () => {
    const time = clock();
    const image = createImageProvider(null, { fetch, now: time.now, log });
    const tooBig: ImageProvider = {
      ...image,
      download: () => Promise.resolve({ ok: false, detail: "result is 5242881 bytes", transient: false }),
    };
    const deps = fakeDependencies({ now: time.now, image: tooBig });
    await queuedJob("too-big");
    await advanceJob(renderEnv(), deps, log, "too-big", OPTIONS);
    time.advance(STUB_RENDER_MS.pro);

    expect(await advanceJob(renderEnv(), deps, log, "too-big", OPTIONS)).toEqual({});
    expect(await job("too-big")).toMatchObject({
      state: "failed",
      failure_code: "render_failed",
      download_attempts: 1,
    });
    expect(deps.alerts).toEqual([expect.stringContaining("result is 5242881 bytes") as string]);
  });
});

describe("render: a result that arrives after its job moved on", () => {
  /** The stub provider, running `during` while the result downloads. */
  function imageThat(during: () => Promise<unknown>, now: () => Date): ImageProvider {
    const image = createImageProvider(null, { fetch, now, log });
    return {
      ...image,
      download: async (url) => {
        await during();
        return image.download(url);
      },
    };
  }

  async function renderWhile(id: string, during: () => Promise<unknown>): Promise<void> {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: imageThat(during, time.now) });
    await queuedJob(id);
    await advanceJob(renderEnv(), deps, log, id, OPTIONS);
    time.advance(STUB_RENDER_MS.pro);
    expect(await advanceJob(renderEnv(), deps, log, id, OPTIONS)).toEqual({});
  }

  it("deletes the result when its person was erased during the download", async () => {
    await renderWhile("erased", () =>
      env.DB.prepare("UPDATE tryon_jobs SET state = 'expired', result_key = NULL WHERE id = 'erased'").run(),
    );
    expect(await job("erased")).toMatchObject({ state: "expired", result_key: null });
    expect(await env.RESULTS.head("results/erased.png")).toBeNull();
  });

  it("keeps the result a parallel run stored first", async () => {
    await renderWhile("parallel", () =>
      env.DB.prepare(
        "UPDATE tryon_jobs SET state = 'ready', result_key = 'results/parallel.png' WHERE id = 'parallel'",
      ).run(),
    );
    expect(await env.RESULTS.head("results/parallel.png")).not.toBeNull();
  });
});

describe("render: failures", () => {
  it("classifies Premium's 502 file-type trap as photo_invalid_file", async () => {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    await queuedJob("trap", { endpoint: "premium", color: "original", marker: "mm-stub:file-type" });

    await advanceJob(renderEnv(), deps, log, "trap", OPTIONS);

    const failed = await job("trap");
    expect(failed).toMatchObject({ state: "failed", failure_code: "photo_invalid_file" });
    expect(failed?.provider_error_detail).toContain("File type not supported");
    expect(deps.alerts).toEqual([]);
  });

  it("fails a refused face as photo_unreadable and skips the message waiting for it", async () => {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    await queuedJob("no-face", { marker: "mm-stub:refused-face" });
    await insertPerson("p", "+919810000001");
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
       VALUES ('m1', ?, 'p', 'tryon_result', 'no-face', 'waiting')`,
    )
      .bind(NOW.toISOString())
      .run();

    await advanceJob(renderEnv(), deps, log, "no-face", OPTIONS);

    expect(await job("no-face")).toMatchObject({ state: "failed", failure_code: "photo_unreadable" });
    const message = await env.DB.prepare("SELECT state FROM outbound_messages WHERE id = 'm1'").first();
    expect(message).toEqual({ state: "skipped" });
  });

  it("tries a transient submit failure again, up to three times in all", async () => {
    const time = clock();
    const down: ImageProvider = {
      ...countingImage(time.now).image,
      submit: () =>
        Promise.resolve({
          ok: false,
          failure: { code: "render_failed", transient: true, alert: false, detail: "503" },
        }),
    };
    const deps = fakeDependencies({ now: time.now, image: down });
    await queuedJob("flaky");

    for (let attempt = 1; attempt < SUBMIT_ATTEMPTS; attempt++) {
      expect(await advanceJob(renderEnv(), deps, log, "flaky", OPTIONS)).toEqual({ retryAfterSeconds: 10 });
    }
    expect(await advanceJob(renderEnv(), deps, log, "flaky", OPTIONS)).toEqual({});
    expect(await job("flaky")).toMatchObject({ state: "failed", failure_code: "render_failed" });
  });

  it("keeps polling a render past 3 minutes, once a minute, because it is billed all the same", async () => {
    const time = clock();
    const slow: ImageProvider = {
      ...countingImage(time.now).image,
      poll: () => Promise.resolve({ state: "running" }),
    };
    const deps = fakeDependencies({ now: time.now, image: slow });
    await queuedJob("slow-premium");
    await advanceJob(renderEnv(), deps, log, "slow-premium", OPTIONS);

    time.advance(6 * 60_000);
    expect(await advanceJob(renderEnv(), deps, log, "slow-premium", OPTIONS)).toEqual({
      retryAfterSeconds: POLL_DELAY_SECONDS.slow,
    });
    expect(await job("slow-premium")).toMatchObject({ state: "rendering" });
  });

  it("gives up 15 minutes after submitting, with an alert naming the task", async () => {
    const time = clock();
    const stuck: ImageProvider = {
      ...countingImage(time.now).image,
      poll: () => Promise.resolve({ state: "running" }),
    };
    const deps = fakeDependencies({ now: time.now, image: stuck });
    await queuedJob("stuck");
    await advanceJob(renderEnv(), deps, log, "stuck", OPTIONS);

    time.advance(RENDER_GIVE_UP_MS + 1);
    expect(await advanceJob(renderEnv(), deps, log, "stuck", OPTIONS)).toEqual({});
    expect(await job("stuck")).toMatchObject({ state: "failed", failure_code: "render_failed" });
    expect(deps.alerts).toEqual([expect.stringMatching(/no result 15 min after submitting; task stub\./) as string]);
  });

  it("alerts on a refused API key, and fails when the photo is gone", async () => {
    const time = clock();
    const refused: ImageProvider = {
      ...countingImage(time.now).image,
      submit: () =>
        Promise.resolve({
          ok: false,
          failure: { code: "render_failed", transient: false, alert: true, detail: "401" },
        }),
    };
    const deps = fakeDependencies({ now: time.now, image: refused });
    await queuedJob("bad-key");
    await advanceJob(renderEnv(), deps, log, "bad-key", OPTIONS);
    expect(deps.alerts).toEqual([expect.stringContaining("bad-key") as string]);

    await queuedJob("no-photo");
    await env.UPLOADS.delete("uploads/no-photo");
    await advanceJob(renderEnv(), deps, log, "no-photo", OPTIONS);
    expect(await job("no-photo")).toMatchObject({ state: "failed", failure_code: "render_failed" });
  });

  it("ignores a message for a job that is finished or unknown", async () => {
    await insertJob({ id: "done", state: "ready" });
    const deps = fakeDependencies();
    expect(await advanceJob(renderEnv(), deps, log, "done", OPTIONS)).toEqual({});
    expect(await advanceJob(renderEnv(), deps, log, "missing", OPTIONS)).toEqual({});
  });
});

describe("render: the queue batch", () => {
  function batchOf(bodies: unknown[]) {
    const messages = bodies.map((body, index) => ({
      id: `m-${String(index)}`,
      body,
      attempts: 1,
      timestamp: NOW,
      ack: vi.fn(),
      retry: vi.fn(),
    }));
    return { queue: "mm-render-local", messages, ackAll: vi.fn(), retryAll: vi.fn() };
  }

  it("retries a running job with a delay, acks a finished one, and drops a malformed message", async () => {
    const running = "00000000-0000-4000-8000-000000000001";
    const finished = "00000000-0000-4000-8000-000000000003";
    await queuedJob(running);
    await insertJob({ id: finished, state: "ready" });
    const batch = batchOf([
      { job_id: running, request_id: "r" },
      { job_id: finished, request_id: "r" },
      { nonsense: true },
    ]);

    await handleRenderBatch(batch as unknown as MessageBatch, renderEnv(), fakeDependencies(), log, OPTIONS);

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: POLL_DELAY_SECONDS.early });
    expect(batch.messages[0]?.ack).not.toHaveBeenCalled();
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[2]?.ack).toHaveBeenCalledOnce();
  });

  it("asks for a delayed retry when a step throws", async () => {
    const id = "00000000-0000-4000-8000-000000000002";
    await queuedJob(id);
    const broken: ImageProvider = {
      ...countingImage(() => NOW).image,
      submit: () => Promise.reject(new Error("D1 hiccup")),
    };
    const batch = batchOf([{ job_id: id, request_id: "r" }]);

    await handleRenderBatch(
      batch as unknown as MessageBatch,
      renderEnv(),
      fakeDependencies({ image: broken }),
      log,
      OPTIONS,
    );

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });
});

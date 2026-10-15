// The render consumer (src/queues/render.ts) against the stub, which fakes YouCam's HTTP API through the real adapter.
// NOW is Monday 21 September 2026, 12 noon in India, and the test moves the clock by hand.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { STUB_RENDER_MS, STUB_STALL_MS } from "../../../src/providers/image/stub.ts";
import { createImageProvider, type ImageProvider } from "../../../src/providers/image/index.ts";
import {
  POLL_DELAY_SECONDS,
  RENDER_GIVE_UP_MS,
  RESULT_URL_LIFETIME_MS,
  SUBMIT_ATTEMPTS,
} from "../../../src/config/pipeline.ts";
import { advanceJob, handleRenderBatch, type RenderEnv } from "../../../src/queues/render.ts";
import { fakeBatch } from "../batches.ts";
import { NOW, captureLogs, fakeDependencies, fakeQueue, markDatabase } from "../helpers.ts";
import { insertJob, insertPerson, syntheticJpeg } from "../tryon-fixtures.ts";

const OPTIONS = { resultRetentionDays: 30 };
const log = createLogger();

/** A clock the test moves by hand, shared by the job code and the stub provider. */
function clock() {
  let ms = NOW.getTime();
  return { now: () => new Date(ms), advance: (by: number) => (ms += by) };
}

/** The stub provider, counting how often it was asked to submit. */
function countingImage(now: () => Date) {
  const image = createImageProvider(null, { fetch, now, log, refsUrl: "https://maneman.in/refs/v1" });
  const submit = vi.fn(image.submit.bind(image));
  return { image: { ...image, submit } satisfies ImageProvider, submit };
}

async function queuedJob(id: string, options: { marker?: string; preset?: string } = {}): Promise<void> {
  await insertJob({
    id,
    state: "queued",
    stage: "crown",
    preset: options.preset ?? "side-part",
    uploaded_at: NOW.toISOString(),
  });
  await env.UPLOADS.put(`uploads/${id}`, syntheticJpeg(800, 800, options.marker ?? ""));
}

function job(id: string) {
  return env.DB.prepare(
    `SELECT state, failure_code, failure_reason, provider_task_id, provider_result_url, result_key, latency_ms,
            download_attempts, provider_error_detail, expires_at, renders, render_key
     FROM tryon_jobs WHERE id = ?`,
  )
    .bind(id)
    .first();
}

function renderEnv(): RenderEnv & { MESSAGE_QUEUE: ReturnType<typeof fakeQueue> } {
  return { DB: env.DB, UPLOADS: env.UPLOADS, RESULTS: env.RESULTS, MESSAGE_QUEUE: fakeQueue() };
}

/** One delivery of the job's message. */
const step = (deps: ReturnType<typeof fakeDependencies>, id: string, options = OPTIONS) =>
  advanceJob({ env: renderEnv(), deps, log, jobId: id, options });

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("render: the happy path", () => {
  it("submits the photograph with the look's reference, polls on a delayed retry, downloads and records the latency", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("job");

    expect(await step(deps, "job")).toEqual({ retryAfterSeconds: POLL_DELAY_SECONDS.early });
    expect(await job("job")).toMatchObject({
      state: "rendering",
      renders: 1,
      provider_task_id: expect.stringMatching(/^stub\./) as string,
    });
    expect(submit.mock.calls[0]?.[1]).toBe("side-part");

    time.advance(3_000);
    expect(await step(deps, "job")).toEqual({ retryAfterSeconds: POLL_DELAY_SECONDS.early });

    time.advance(STUB_RENDER_MS);
    expect(await step(deps, "job")).toEqual({});

    const done = await job("job");
    expect(done).toMatchObject({ state: "ready", result_key: "results/job.png", latency_ms: 3_000 + STUB_RENDER_MS });
    expect(done?.provider_result_url).toMatch(/^https:\/\/stub-results\.youcam\.test\//);
    expect((await env.RESULTS.head("results/job.png"))?.httpMetadata?.contentType).toBe("image/png");
    expect(submit).toHaveBeenCalledOnce();
  });

  // Nothing checked the date a result is deleted by, so a slip could keep one past what the notice promises.
  it("keeps a ready result for the retention days set, counted from the moment it is ready and no longer", async () => {
    for (const [id, days] of [
      ["kept-3", 3],
      ["kept-30", 30],
    ] as const) {
      const time = clock();
      const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
      // A photograph of each job's own, or the second would be a copy of the first, made at once.
      await queuedJob(id, { marker: id });
      await step(deps, id, { ...OPTIONS, resultRetentionDays: days });
      time.advance(STUB_RENDER_MS);
      await step(deps, id, { ...OPTIONS, resultRetentionDays: days });

      const ready = await job(id);
      expect(ready?.state).toBe("ready");
      expect(ready?.expires_at).toBe(new Date(time.now().getTime() + days * 24 * 60 * 60 * 1000).toISOString());
    }
  });

  it("polls every 2 s for the first 20 s, then every 5 s", async () => {
    const time = clock();
    const slow: ImageProvider = { ...countingImage(time.now).image, poll: () => Promise.resolve({ state: "running" }) };
    const deps = fakeDependencies({ now: time.now, image: slow });
    await queuedJob("slow");
    await step(deps, "slow");

    time.advance(19_000);
    expect(await step(deps, "slow")).toEqual({ retryAfterSeconds: 2 });
    time.advance(2_000);
    expect(await step(deps, "slow")).toEqual({ retryAfterSeconds: 5 });
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

    await advanceJob({ env: bindings, deps, log, jobId: "gated", options: OPTIONS });
    time.advance(STUB_RENDER_MS);
    await advanceJob({ env: bindings, deps, log, jobId: "gated", options: OPTIONS });

    const message = await env.DB.prepare("SELECT state, queued_at FROM outbound_messages WHERE id = 'm1'").first();
    expect(message).toEqual({ state: "queued", queued_at: time.now().toISOString() });
    expect(bindings.MESSAGE_QUEUE.sent).toEqual([{ message_id: "m1", request_id: "request" }]);
  });
});

describe("render: one render for each photograph and look", () => {
  async function rendered(deps: ReturnType<typeof fakeDependencies>, time: ReturnType<typeof clock>, id: string) {
    await step(deps, id);
    time.advance(STUB_RENDER_MS);
    await step(deps, id);
  }

  it("copies the image of the same photograph in the same look, and asks YouCam nothing", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("first");
    await rendered(deps, time, "first");

    await queuedJob("again");
    expect(await step(deps, "again")).toEqual({});
    const again = await job("again");
    expect(again).toMatchObject({ state: "ready", result_key: "results/again.png", provider_task_id: null });
    expect(again?.render_key).toBe((await job("first"))?.render_key);
    expect(await env.RESULTS.head("results/again.png")).not.toBeNull();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("renders the same photograph in another look, or once the earlier image is gone", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("first");
    await rendered(deps, time, "first");

    await queuedJob("quiff", { preset: "quiff" });
    await step(deps, "quiff");
    expect(await job("quiff")).toMatchObject({ state: "rendering" });

    await env.RESULTS.delete("results/first.png");
    await queuedJob("gone");
    await step(deps, "gone");
    expect(await job("gone")).toMatchObject({ state: "rendering" });
    expect(submit).toHaveBeenCalledTimes(3);
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

    expect(await step(deps, "twice")).toEqual({});
    expect(submit).not.toHaveBeenCalled();
  });

  it("recovers a stalled download from the stored URL, without a second render", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("stalled", { marker: "mm-stub:stall" });

    await step(deps, "stalled");
    time.advance(STUB_RENDER_MS);
    expect(await step(deps, "stalled")).toEqual({ retryAfterSeconds: 60 });
    const waiting = await job("stalled");
    expect(waiting).toMatchObject({ state: "downloading", download_attempts: 1 });
    expect(waiting?.provider_result_url).toMatch(/^https:/);

    time.advance(STUB_STALL_MS);
    expect(await step(deps, "stalled")).toEqual({});
    expect(await job("stalled")).toMatchObject({ state: "ready", download_attempts: 2 });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("leaves a download to the sweeper after three quick tries, and fails with an alert once the URL expires", async () => {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    await queuedJob("lost", { marker: "mm-stub:stall" });
    await step(deps, "lost");
    time.advance(STUB_RENDER_MS);
    await step(deps, "lost"); // attempt 1
    await step(deps, "lost"); // attempt 2
    expect(await step(deps, "lost")).toEqual({}); // attempt 3: the sweeper takes over

    time.advance(RESULT_URL_LIFETIME_MS);
    await step(deps, "lost");
    expect(await job("lost")).toMatchObject({ state: "failed", failure_code: "render_failed" });
    expect(deps.alerts).toEqual([expect.stringContaining("a billed image is lost") as string]);
  });
});

describe("render: a result that can never be used", () => {
  it("fails at once with render_failed and an alert, rather than downloading it again", async () => {
    const time = clock();
    const image = createImageProvider(null, { fetch, now: time.now, log, refsUrl: "https://maneman.in/refs/v1" });
    const tooBig: ImageProvider = {
      ...image,
      download: () => Promise.resolve({ ok: false, detail: "result is 5242881 bytes", transient: false }),
    };
    const deps = fakeDependencies({ now: time.now, image: tooBig });
    await queuedJob("too-big");
    await step(deps, "too-big");
    time.advance(STUB_RENDER_MS);

    expect(await step(deps, "too-big")).toEqual({});
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
    const image = createImageProvider(null, { fetch, now, log, refsUrl: "https://maneman.in/refs/v1" });
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
    await step(deps, id);
    time.advance(STUB_RENDER_MS);
    expect(await step(deps, id)).toEqual({});
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

describe("render: what YouCam refuses", () => {
  async function refused(marker: string) {
    const time = clock();
    const deps = fakeDependencies({ now: time.now, image: countingImage(time.now).image });
    await queuedJob("refused", { marker });
    await step(deps, "refused");
    time.advance(STUB_RENDER_MS);
    await step(deps, "refused");
    return { deps, row: await job("refused") };
  }

  it("names the photograph's fault, keeps YouCam's code verbatim, and skips the message waiting for it", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
       VALUES ('m1', ?, 'p', 'tryon_result', 'refused', 'waiting')`,
    )
      .bind(NOW.toISOString())
      .run();
    const { deps, row } = await refused("mm-stub:no-shoulder");

    expect(row).toMatchObject({ state: "failed", failure_code: "photo_unreadable", failure_reason: "no_shoulders" });
    expect(row?.provider_error_detail).toContain("error_no_shoulder");
    expect(deps.alerts).toEqual([]);
    const message = await env.DB.prepare("SELECT state FROM outbound_messages WHERE id = 'm1'").first();
    expect(message).toEqual({ state: "skipped" });
  });

  it("alerts loudly on a head YouCam calls too short of hair to style, which it never did in our tests", async () => {
    const { deps, row } = await refused("mm-stub:hair-too-short");
    expect(row).toMatchObject({ failure_code: "photo_unreadable", failure_reason: "not_styleable" });
    expect(deps.alerts).toEqual([expect.stringContaining("error_hair_too_short") as string]);
  });

  it("makes a render YouCam's model failed once more, and fails it after the second", async () => {
    const time = clock();
    const { image, submit } = countingImage(time.now);
    const deps = fakeDependencies({ now: time.now, image });
    await queuedJob("model", { marker: "mm-stub:inference" });
    await step(deps, "model");
    time.advance(STUB_RENDER_MS);
    expect(await step(deps, "model")).toEqual({ retryAfterSeconds: 10 });
    expect(await job("model")).toMatchObject({ state: "queued", renders: 1, provider_task_id: null });

    await step(deps, "model");
    time.advance(STUB_RENDER_MS);
    expect(await step(deps, "model")).toEqual({});
    expect(await job("model")).toMatchObject({ state: "failed", failure_code: "render_failed", renders: 2 });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("gives a render two minutes, makes it once more, and fails it with an alert naming the task", async () => {
    const time = clock();
    const stuck: ImageProvider = {
      ...countingImage(time.now).image,
      poll: () => Promise.resolve({ state: "running" }),
    };
    const deps = fakeDependencies({ now: time.now, image: stuck });
    await queuedJob("stuck");
    await step(deps, "stuck");
    time.advance(RENDER_GIVE_UP_MS + 1);
    await step(deps, "stuck");
    expect(await job("stuck")).toMatchObject({ state: "queued" });

    await step(deps, "stuck");
    time.advance(RENDER_GIVE_UP_MS + 1);
    expect(await step(deps, "stuck")).toEqual({});
    expect(await job("stuck")).toMatchObject({ state: "failed", failure_code: "render_failed" });
    expect(deps.alerts).toEqual([expect.stringMatching(/no result 2 min after submitting; task stub\./) as string]);
  });

  it("tries a transient submit failure again, backing off, up to three times in all", async () => {
    const time = clock();
    const down: ImageProvider = {
      ...countingImage(time.now).image,
      submit: () =>
        Promise.resolve({
          ok: false,
          failure: { code: "render_failed", transient: true, alert: false, detail: "429" },
        }),
    };
    const deps = fakeDependencies({ now: time.now, image: down });
    await queuedJob("flaky");

    for (let attempt = 1; attempt < SUBMIT_ATTEMPTS; attempt++) {
      expect(await step(deps, "flaky")).toEqual({ retryAfterSeconds: 10 * attempt });
    }
    expect(await step(deps, "flaky")).toEqual({});
    expect(await job("flaky")).toMatchObject({ state: "failed", failure_code: "render_failed" });
  });

  it("pages ops while the key is refused, as paused, and clears the page once a render is made", async () => {
    const time = clock();
    const working = countingImage(time.now).image;
    const keyless: ImageProvider = {
      ...working,
      submit: () =>
        Promise.resolve({
          ok: false,
          failure: {
            code: "render_failed",
            reason: "unavailable",
            transient: false,
            alert: true,
            urgentKey: "tryon_paused:key",
            detail: "401 InvalidApiKey",
          },
        }),
    };
    await queuedJob("paused");
    await step(fakeDependencies({ now: time.now, image: keyless }), "paused");
    expect(await job("paused")).toMatchObject({ failure_code: "render_failed", failure_reason: "unavailable" });
    const open = () => env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL").all();
    expect((await open()).results).toEqual([{ key: "tryon_paused:key" }]);

    const deps = fakeDependencies({ now: time.now, image: working });
    await queuedJob("working", { preset: "quiff" });
    await step(deps, "working");
    time.advance(STUB_RENDER_MS);
    await step(deps, "working");
    expect((await open()).results).toEqual([]);
  });

  it("fails when the photo is gone, and ignores a message for a job that is finished or unknown", async () => {
    const deps = fakeDependencies();
    await queuedJob("no-photo");
    await env.UPLOADS.delete("uploads/no-photo");
    await step(deps, "no-photo");
    expect(await job("no-photo")).toMatchObject({ state: "failed", failure_code: "render_failed" });

    await insertJob({ id: "done", state: "ready" });
    expect(await step(deps, "done")).toEqual({});
    expect(await step(deps, "missing")).toEqual({});
  });
});

describe("render: the queue batch", () => {
  const batchOf = (bodies: unknown[]) => fakeBatch("mm-render-local", bodies, { timestamp: NOW });

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

    await handleRenderBatch({ batch, env: renderEnv(), deps: fakeDependencies(), log, options: OPTIONS });

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: POLL_DELAY_SECONDS.early });
    expect(batch.messages[0]?.ack).not.toHaveBeenCalled();
    expect(batch.messages[1]?.ack).toHaveBeenCalledOnce();
    expect(batch.messages[2]?.ack).toHaveBeenCalledOnce();
  });

  it("asks for a delayed retry when a step throws", async () => {
    const id = "00000000-0000-4000-8000-000000000002";
    await queuedJob(id);
    const broken: ImageProvider = { ...countingImage(() => NOW).image, submit: () => Promise.reject(new Error("D1")) };
    const batch = batchOf([{ job_id: id, request_id: "r" }]);

    await handleRenderBatch({
      batch,
      env: renderEnv(),
      deps: fakeDependencies({ image: broken }),
      log,
      options: OPTIONS,
    });

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
  });
});

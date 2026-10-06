import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import type { Connection } from "../../../src/providers/messaging/index.ts";
import { sweep } from "../../../src/scheduled/sweeper.ts";
import { captureLogs, fakeDependencies, markDatabase } from "../helpers.ts";
import { insertJob, insertPerson } from "../tryon-fixtures.ts";
import { minutesAgo, minutesAhead, sweepEnv, OPTIONS } from "./sweeper-fixtures.ts";

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("sweeper: try-on", () => {
  it("re-enqueues renders whose message was lost, and fails a submit that died part-way", async () => {
    await insertJob({ id: "lost-queued", state: "queued", created_at: minutesAgo(3) });
    await insertJob({ id: "fresh-queued", state: "queued", created_at: minutesAgo(1) });
    await insertJob({ id: "silent-render", state: "rendering", submitted_at: minutesAgo(18), provider_task_id: "t" });
    await insertJob({ id: "live-render", state: "rendering", submitted_at: minutesAgo(6), provider_task_id: "t" });
    await insertJob({
      id: "dead-submit",
      state: "queued",
      created_at: minutesAgo(20),
      submit_started_at: minutesAgo(15),
    });
    const { bindings, queues } = sweepEnv();

    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.rendersRequeued).toBe(2);
    expect(queues.render.sent).toEqual([
      { job_id: "lost-queued", request_id: "sweeper" },
      { job_id: "silent-render", request_id: "sweeper" },
    ]);
    const dead = await env.DB.prepare("SELECT state, failure_code FROM tryon_jobs WHERE id = 'dead-submit'").first();
    expect(dead).toEqual({ state: "failed", failure_code: "render_failed" });
  });

  it("retries a stored result URL until it expires, then fails the job and alerts once", async () => {
    const downloading = { state: "downloading", provider_task_id: "t", provider_result_url: "https://cdn.test/r.png" };
    await insertJob({ ...downloading, id: "never-tried", provider_result_expires_at: minutesAhead(600) });
    await insertJob({
      ...downloading,
      id: "tried-just-now",
      provider_result_expires_at: minutesAhead(600),
      download_attempts: 4,
      download_attempted_at: minutesAgo(1),
    });
    await insertJob({
      ...downloading,
      id: "many-tries-an-hour-ago",
      provider_result_expires_at: minutesAhead(600),
      download_attempts: 20,
      download_attempted_at: minutesAgo(61),
    });
    await insertJob({ ...downloading, id: "expired-url", provider_result_expires_at: minutesAgo(1) });
    const { bindings, queues } = sweepEnv();
    const deps = fakeDependencies();

    const summary = await sweep(bindings, deps, createLogger(), OPTIONS);
    await sweep(bindings, deps, createLogger(), OPTIONS);

    expect(summary.downloadsRequeued).toBe(2);
    expect(queues.render.sent.slice(0, 2)).toEqual([
      { job_id: "never-tried", request_id: "sweeper" },
      { job_id: "many-tries-an-hour-ago", request_id: "sweeper" },
    ]);
    const lost = await env.DB.prepare("SELECT state FROM tryon_jobs WHERE id = 'expired-url'").first();
    expect(lost).toEqual({ state: "failed" });
    expect(deps.alerts).toEqual([expect.stringContaining("expired-url") as string]);
  });

  it("re-enqueues result messages queued over five minutes ago and not being sent", async () => {
    await insertPerson("p", "+919810000001");
    const message = (id: string, queuedAt: string, sendingAt: string | null) =>
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at, sending_at)
         VALUES (?, ?, 'p', 'tryon_result', 'job', 'queued', ?, ?)`,
      ).bind(id, queuedAt, queuedAt, sendingAt);
    await env.DB.batch([
      message("stale", minutesAgo(6), null),
      message("recent", minutesAgo(2), null),
      message("being-sent", minutesAgo(6), minutesAgo(1)),
    ]);
    const { bindings, queues } = sweepEnv();

    expect((await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS)).messagesRequeued).toBe(1);
    expect(queues.messages.sent).toEqual([{ message_id: "stale", request_id: "sweeper" }]);
  });

  /** A try-on result message, queued `minutes` ago, with what its last try said. */
  const queuedMessage = (id: string, minutes: number, lastError: string | null = null) =>
    env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at, last_error)
       VALUES (?1, ?2, 'p', 'tryon_result', 'job', 'queued', ?2, ?3)`,
    ).bind(id, minutesAgo(minutes), lastError);

  it("holds queued messages while the WhatsApp bridge is down, and sends them again once it is open", async () => {
    await insertPerson("p", "+919810000001");
    await queuedMessage("waiting", 30, "HTTP 404 Not Found").run();
    const { bindings, queues } = sweepEnv();
    const open = fakeDependencies();
    const missing: Connection = { open: false, fault: "no_instance", detail: "no instance" };
    const down = { ...open, messaging: { ...open.messaging, connection: () => Promise.resolve(missing) } };

    expect((await sweep(bindings, down, createLogger(), OPTIONS)).messagesRequeued).toBe(0);
    expect(queues.messages.sent).toEqual([]);

    expect((await sweep(bindings, open, createLogger(), OPTIONS)).messagesRequeued).toBe(1);
    expect(queues.messages.sent).toEqual([{ message_id: "waiting", request_id: "sweeper" }]);
  });

  it("asks the bridge only when a message is waiting, and not once the run has no call left", async () => {
    const { bindings, queues } = sweepEnv();
    const deps = fakeDependencies();
    let asked = 0;
    const connection = (): Promise<Connection> => {
      asked += 1;
      return Promise.resolve({ open: true });
    };
    const counting = { ...deps, messaging: { ...deps.messaging, connection } };

    await sweep(bindings, counting, createLogger(), OPTIONS);
    expect(asked).toBe(0);

    await insertPerson("p", "+919810000001");
    await queuedMessage("waiting", 30).run();
    await sweep(bindings, counting, createLogger(), { ...OPTIONS, budget: createCallBudget(0) });
    expect(asked).toBe(0);
    expect(queues.messages.sent).toEqual([]);
  });

  it("fails a message still unsent a day after it was queued, and tells ops once a day", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.batch([
      queuedMessage("day-old", 24 * 60 + 1, "HTTP 404 Not Found"),
      queuedMessage("hours-old", 23 * 60),
    ]);
    const { bindings, queues } = sweepEnv();
    const deps = fakeDependencies();

    await sweep(bindings, deps, createLogger(), OPTIONS);

    const rows = await env.DB.prepare("SELECT id, state, last_error FROM outbound_messages ORDER BY id").all();
    expect(rows.results).toEqual([
      { id: "day-old", state: "failed", last_error: "not sent within a day: HTTP 404 Not Found" },
      { id: "hours-old", state: "queued", last_error: null },
    ]);
    expect(queues.messages.sent).toEqual([{ message_id: "hours-old", request_id: "sweeper" }]);
    expect(deps.alerts).toEqual([
      expect.stringContaining("1 on this run, day-old (tryon_result) among them") as string,
    ]);

    await queuedMessage("also-day-old", 24 * 60 + 2).run();
    await sweep(bindings, deps, createLogger(), OPTIONS);
    expect(await env.DB.prepare("SELECT state FROM outbound_messages WHERE id = 'also-day-old'").first()).toEqual({
      state: "failed",
    });
    expect(deps.alerts).toHaveLength(1);
  });

  it("expires abandoned uploads after an hour and results past their date, deleting the result", async () => {
    await insertJob({ id: "abandoned", state: "awaiting_upload", created_at: minutesAgo(61) });
    await insertJob({ id: "waiting", state: "awaiting_upload", created_at: minutesAgo(10) });
    await insertJob({
      id: "old-result",
      state: "ready",
      result_key: "results/old-result.png",
      expires_at: minutesAgo(1),
    });
    await insertJob({
      id: "new-result",
      state: "ready",
      result_key: "results/new-result.png",
      expires_at: minutesAhead(60),
    });
    await env.RESULTS.put("results/old-result.png", "x");
    await env.RESULTS.put("results/new-result.png", "x");

    const summary = await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.jobsExpired).toBe(2);
    const states = await env.DB.prepare("SELECT id, state FROM tryon_jobs ORDER BY id").all();
    expect(states.results).toEqual([
      { id: "abandoned", state: "expired" },
      { id: "new-result", state: "ready" },
      { id: "old-result", state: "expired" },
      { id: "waiting", state: "awaiting_upload" },
    ]);
    expect(await env.RESULTS.head("results/old-result.png")).toBeNull();
    expect(await env.RESULTS.head("results/new-result.png")).not.toBeNull();
  });

  // ADR 0104: the gate comes before the render, so a visitor who leaves between them leaves a message waiting.
  it("skips the look's message of a claimed try-on whose render was never asked for, once it expires", async () => {
    await insertPerson("p", "+919810000001");
    await insertJob({ id: "left", state: "awaiting_upload", created_at: minutesAgo(61), person_id: "p" });
    await insertJob({ id: "still-here", state: "awaiting_upload", created_at: minutesAgo(10), person_id: "p" });
    const message = (id: string, jobId: string) =>
      env.DB.prepare(
        `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state)
         VALUES (?, ?, 'p', 'tryon_result', ?, 'waiting')`,
      ).bind(id, minutesAgo(61), jobId);
    await env.DB.batch([message("for-left", "left"), message("for-still-here", "still-here")]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    const messages = await env.DB.prepare("SELECT id, state, last_error FROM outbound_messages ORDER BY id").all();
    expect(messages.results).toEqual([
      { id: "for-left", state: "skipped", last_error: "no look was made" },
      { id: "for-still-here", state: "waiting", last_error: null },
    ]);
  });

  // Keeping a look on its day costs about eight calls to D1 and R2, of the 1,000 a run may make.
  it("expires at most 40 looks past their day a run, and the next run the rest", async () => {
    for (let n = 1; n <= 45; n += 1) {
      await insertJob({ id: `look-${String(n)}`, state: "ready", expires_at: minutesAgo(n) });
    }
    const first = await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);
    expect(first.jobsExpired).toBe(40);
    const second = await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);
    expect(second.jobsExpired).toBe(5);
    const ready = await env.DB.prepare("SELECT COUNT(*) AS n FROM tryon_jobs WHERE state = 'ready'").first("n");
    expect(ready).toBe(0);
  });

  it("deletes a photo an hour after its last look, unless a look is still rendering", async () => {
    const photo = (key: string) => ({ upload_key: key, uploaded_at: minutesAgo(90) });
    await insertJob({ ...photo("uploads/done"), id: "done-1", state: "ready", created_at: minutesAgo(90) });
    await insertJob({ ...photo("uploads/done"), id: "done-2", state: "failed", created_at: minutesAgo(70) });
    await insertJob({ ...photo("uploads/busy"), id: "busy-1", state: "ready", created_at: minutesAgo(90) });
    await insertJob({ ...photo("uploads/busy"), id: "busy-2", state: "rendering", created_at: minutesAgo(80) });
    await insertJob({ ...photo("uploads/recent"), id: "recent", state: "ready", created_at: minutesAgo(30) });
    for (const key of ["uploads/done", "uploads/busy", "uploads/recent"]) await env.UPLOADS.put(key, "photo");

    const summary = await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.photosDeleted).toBe(1);
    expect(await env.UPLOADS.head("uploads/done")).toBeNull();
    expect(await env.UPLOADS.head("uploads/busy")).not.toBeNull();
    expect(await env.UPLOADS.head("uploads/recent")).not.toBeNull();
    const marked = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM tryon_jobs WHERE upload_deleted_at IS NOT NULL",
    ).first();
    expect(marked).toEqual({ n: 2 });
  });
});

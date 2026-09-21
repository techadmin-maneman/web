import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { MAX_SYNC_ATTEMPTS } from "../../src/queues/crm-sync.ts";
import { sweep, type SweepEnv } from "../../src/scheduled/sweeper.ts";
import { NOW, captureLogs, fakeDependencies, fakeQueue, markDatabase } from "./helpers.ts";
import { insertJob, insertPerson } from "./tryon-fixtures.ts";

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const minutesAhead = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

async function insertLead(id: string, state: string, attempts: number, createdAt: string): Promise<void> {
  await insertPerson("p", "+919810000001");
  await env.DB.prepare(
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, sync_state, sync_attempts, request_id)
     VALUES (?, 'p', ?, 'form', 'Gurgaon', 'weekday_am', 'crown', ?, ?, 'r')`,
  )
    .bind(id, createdAt, state, attempts)
    .run();
}

function sweepEnv() {
  const queues = { crm: fakeQueue(), render: fakeQueue(), messages: fakeQueue() };
  const bindings: SweepEnv = {
    DB: env.DB,
    UPLOADS: env.UPLOADS,
    RESULTS: env.RESULTS,
    CRM_QUEUE: queues.crm,
    RENDER_QUEUE: queues.render,
    MESSAGE_QUEUE: queues.messages,
  };
  return { bindings, queues };
}

const OPTIONS = { creditFloor: 200 };

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("sweeper: leads", () => {
  it("re-enqueues pending leads older than two minutes and failed leads with attempts left", async () => {
    await insertLead("pending-old", "pending", 0, minutesAgo(3));
    await insertLead("pending-new", "pending", 0, minutesAgo(1)); // its queue message is probably still on the way
    await insertLead("failed-retry", "failed", 4, minutesAgo(30));
    await insertLead("failed-final", "failed", MAX_SYNC_ATTEMPTS, minutesAgo(90));
    await insertLead("synced", "synced", 1, minutesAgo(60));
    const { bindings, queues } = sweepEnv();

    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.leadsRequeued).toBe(2);
    expect(queues.crm.sent).toEqual([
      { lead_id: "failed-retry", request_id: "sweeper" },
      { lead_id: "pending-old", request_id: "sweeper" },
    ]);
  });

  it("sends nothing when there is nothing to retry", async () => {
    const { bindings, queues } = sweepEnv();
    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);
    expect(summary).toMatchObject({ leadsRequeued: 0, messagesRequeued: 0, rendersRequeued: 0, downloadsRequeued: 0 });
    expect([...queues.crm.sent, ...queues.render.sent, ...queues.messages.sent]).toEqual([]);
  });

  it("removes idempotency records older than a day, counters older than three days, and expired sessions", async () => {
    await insertPerson("p", "+919810000001");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('old', 'r', 'h', ?)").bind(
        minutesAgo(25 * 60),
      ),
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('new', 'r', 'h', ?)").bind(
        minutesAgo(60),
      ),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-17', 1)"),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-20T10', 1)"),
      env.DB.prepare(
        "INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('gone', 'p', ?, ?)",
      ).bind(minutesAgo(40), minutesAgo(10)),
      env.DB.prepare(
        "INSERT INTO tryon_sessions (id, person_id, created_at, expires_at) VALUES ('live', 'p', ?, ?)",
      ).bind(minutesAgo(10), minutesAhead(20)),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT key FROM idempotency").all()).results).toEqual([{ key: "new" }]);
    expect((await env.DB.prepare("SELECT window_start FROM counters").all()).results).toEqual([
      { window_start: "2026-09-20T10" },
    ]);
    expect((await env.DB.prepare("SELECT id FROM tryon_sessions").all()).results).toEqual([{ id: "live" }]);
  });
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

describe("sweeper: AILabTools credits", () => {
  const onTheHour = new Date("2026-09-21T07:00:00Z");

  it("reads the balance once an hour and alerts below the floor", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    const summary = await sweep(sweepEnv().bindings, deps, createLogger(), { creditFloor: 5000 });
    expect(summary.credits).toBe(1000); // the stub's two pools, summed
    expect(deps.alerts).toEqual([expect.stringContaining("credits are down to 1000") as string]);
  });

  it("stays quiet above the floor, and skips the check between hours", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    expect((await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS)).credits).toBe(1000);
    expect(deps.alerts).toEqual([]);
    expect((await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS)).credits).toBeUndefined();
  });

  it("logs, and does not alert, when the balance cannot be read", async () => {
    const deps = fakeDependencies({
      now: () => onTheHour,
      image: { ...fakeDependencies().image, credits: () => Promise.resolve(null) },
    });
    expect((await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS)).credits).toBeNull();
    expect(deps.alerts).toEqual([]);
  });
});

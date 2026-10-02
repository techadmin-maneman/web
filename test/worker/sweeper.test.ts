import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import type { Connection } from "../../src/providers/messaging.ts";
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
  const queues = { crm: fakeQueue(), render: fakeQueue(), messages: fakeQueue(), fsm: fakeQueue() };
  const bindings: SweepEnv = {
    DB: env.DB,
    UPLOADS: env.UPLOADS,
    RESULTS: env.RESULTS,
    CLIENT_PHOTOS: env.CLIENT_PHOTOS,
    CRM_QUEUE: queues.crm,
    RENDER_QUEUE: queues.render,
    MESSAGE_QUEUE: queues.messages,
    FSM_QUEUE: queues.fsm,
  };
  return { bindings, queues };
}

const OPTIONS = { creditFloor: 200, budget: createCallBudget(Infinity) };

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

  it("removes login codes and the site's number codes a day past expiry, and client sessions 30 days after they end", async () => {
    const day = 24 * 60;
    const challenge = (id: string, expiredMinutesAgo: number) =>
      env.DB.prepare(
        `INSERT INTO otp_challenges (id, created_at, purpose, channel, last_sent_at, expires_at)
         VALUES (?1, ?2, 'login', 'whatsapp', ?2, ?3)`,
      ).bind(id, minutesAgo(expiredMinutesAgo + 10), minutesAgo(expiredMinutesAgo));
    const numberCode = (id: string, expiredMinutesAgo: number) =>
      env.DB.prepare(
        `INSERT INTO number_codes (id, created_at, mobile_hash, code_hash, expires_at)
         VALUES (?1, ?2, 'mobile-hash', 'code-hash', ?3)`,
      ).bind(id, minutesAgo(expiredMinutesAgo + 10), minutesAgo(expiredMinutesAgo));
    const session = (id: string, expires: string, revoked: string | null) =>
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, revoked_at)
         VALUES (?1, 'client', 'p', ?2, ?2, ?3, ?4)`,
      ).bind(id, minutesAgo(100 * day), expires, revoked);
    await env.DB.batch([
      challenge("old-code", day + 1),
      challenge("recent-code", 60),
      numberCode("old-number-code", day + 1),
      numberCode("recent-number-code", 60),
      session("long-expired", minutesAgo(31 * day), null),
      session("long-revoked", minutesAhead(day), minutesAgo(31 * day)),
      session("recently-revoked", minutesAhead(day), minutesAgo(day)),
      session("live", minutesAhead(day), null),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT id FROM otp_challenges").all()).results).toEqual([{ id: "recent-code" }]);
    expect((await env.DB.prepare("SELECT id FROM number_codes").all()).results).toEqual([{ id: "recent-number-code" }]);
    expect((await env.DB.prepare("SELECT id FROM sessions ORDER BY id").all()).results).toEqual([
      { id: "live" },
      { id: "recently-revoked" },
    ]);
  });

  // A revoked phone keeps pointing at its last session; deleting that session
  // under it failed the whole batch, and the cron with it.
  it("frees a phone from a technician session before deleting the session", async () => {
    const day = 24 * 60;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
         VALUES ('t1', 'resource-1', 'Imran Qureshi', 'IQ', 1, ?1)`,
      ).bind(minutesAgo(40 * day)),
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at, revoked_at)
         VALUES ('revoked-long-ago', 'technician', 't1', ?1, ?2, ?3, ?2)`,
      ).bind(minutesAgo(40 * day), minutesAgo(31 * day), minutesAhead(50 * day)),
      env.DB.prepare(
        `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
         VALUES ('expired-long-ago', 'technician', 't1', ?1, ?2, ?2)`,
      ).bind(minutesAgo(130 * day), minutesAgo(31 * day)),
      env.DB.prepare(
        `INSERT INTO technician_devices (id, technician_id, device_id, session_id, label, created_at, last_seen_at, revoked_at)
         VALUES ('d1', 't1', 'phone-1', 'revoked-long-ago', 'Chrome on Android', ?1, ?2, ?2)`,
      ).bind(minutesAgo(40 * day), minutesAgo(31 * day)),
      env.DB.prepare(
        `INSERT INTO technician_devices (id, technician_id, device_id, session_id, label, created_at, last_seen_at)
         VALUES ('d2', 't1', 'phone-2', 'expired-long-ago', 'Safari on iPhone', ?1, ?2)`,
      ).bind(minutesAgo(130 * day), minutesAgo(31 * day)),
    ]);

    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect((await env.DB.prepare("SELECT id FROM sessions").all()).results).toEqual([]);
    expect(
      (await env.DB.prepare("SELECT id, session_id, revoked_at FROM technician_devices ORDER BY id").all()).results,
    ).toEqual([
      { id: "d1", session_id: null, revoked_at: minutesAgo(31 * day) },
      { id: "d2", session_id: null, revoked_at: null },
    ]);
  });
});

describe("sweeper: a technician's steps", () => {
  /** A step on visit `visit`, landed `landed` minutes ago, not yet written to FSM unless `state` says. */
  const step = (id: string, visit: string, kind: string, landed: number, state = "pending") =>
    env.DB.prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         fsm_write_state, updated_at)
       VALUES (?1, ?2, ?1, 't1', ?3, '{}', ?4, ?4, ?5, ?4)`,
    ).bind(id, visit, kind, minutesAgo(landed), state);

  beforeEach(async () => {
    const visit = (id: string) =>
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, type, status, fsm_status, fsm_modified_at, synced_at)
         VALUES (?1, ?1, 'service', 'in_progress', 'In Progress', ?2, ?2)`,
      ).bind(id, minutesAgo(60));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'r-1', 'Imran Qureshi', 'IQ', 1, ?1)",
      ).bind(minutesAgo(60)),
      visit("visit-lost"),
      visit("visit-fresh"),
      visit("visit-done"),
      // Its queue message never came: the send failed after the step landed.
      step("lost-start", "visit-lost", "start", 40),
      step("lost-photos", "visit-lost", "before_photos", 39),
      step("fresh-start", "visit-fresh", "start", 3),
      step("done-start", "visit-done", "start", 50, "written"),
    ]);
  });

  it("sends a job's earliest step that never reached FSM on again, and leaves its next to follow it", async () => {
    const { bindings, queues } = sweepEnv();

    await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(queues.fsm.sent).toEqual([{ job_event_id: "lost-start", request_id: "sweeper" }]);
  });

  it("does not send it again while its retries may still be running", async () => {
    await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS);
    const again = sweepEnv();

    await sweep(again.bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(again.queues.fsm.sent).toEqual([]);
  });

  it("tells ops once of a job's step still not in FSM an hour after it landed, with IDs only", async () => {
    await step("stuck-start", "visit-fresh", "check_in", 61).run();
    const deps = fakeDependencies();

    await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS);
    expect(deps.alerts).toEqual([
      "A technician's check_in (job event stuck-start) on visit visit-fresh has waited over an hour to reach FSM. " +
        "The sweeper keeps sending it; if it has not landed soon, enter it in FSM by hand. " +
        "http://ops.localhost:4323/dispatch",
    ]);

    await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS);
    expect(deps.alerts).toHaveLength(1);
  });

  it("says nothing of a step under an hour old, and names only a job's earliest step", async () => {
    await step("done-photos", "visit-done", "before_photos", 70).run();
    await step("done-checklist", "visit-done", "checklist", 65).run();
    const deps = fakeDependencies();
    await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS);
    expect(deps.alerts).toEqual([expect.stringContaining("(job event done-photos)") as string]);
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

describe("sweeper: AILabTools credits", () => {
  const onTheHour = new Date("2026-09-21T07:00:00Z");

  it("reads the balance once an hour and alerts below the floor", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    const summary = await sweep(sweepEnv().bindings, deps, createLogger(), { ...OPTIONS, creditFloor: 5000 });
    expect(summary.credits).toBe(1000); // the stub's two pools, summed
    expect(deps.alerts).toEqual([expect.stringContaining("credits are down to 1000") as string]);
  });

  it("tells ops once, not every hour, until a top-up lifts the balance over the floor", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    const low = { ...OPTIONS, creditFloor: 5000 };
    await sweep(sweepEnv().bindings, deps, createLogger(), low);
    await sweep(sweepEnv().bindings, deps, createLogger(), low);
    expect(deps.alerts).toHaveLength(1);

    await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS);
    await sweep(sweepEnv().bindings, deps, createLogger(), low);
    expect(deps.alerts).toHaveLength(2);
  });

  it("stays quiet above the floor, and skips the check between hours", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    expect((await sweep(sweepEnv().bindings, deps, createLogger(), OPTIONS)).credits).toBe(1000);
    expect(deps.alerts).toEqual([]);
    expect((await sweep(sweepEnv().bindings, fakeDependencies(), createLogger(), OPTIONS)).credits).toBeUndefined();
  });

  it("leaves the balance to the next hour when the cron run has no call left for it", async () => {
    const deps = fakeDependencies({ now: () => onTheHour });
    const spent = { ...OPTIONS, budget: createCallBudget(0) };
    expect((await sweep(sweepEnv().bindings, deps, createLogger(), spent)).credits).toBeUndefined();
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

describe("sweeper: erasures", () => {
  it("re-enqueues erased people whose CRM record is not yet blanked, after two minutes, until the last attempt", async () => {
    const people = [
      { id: "pending", erasedAt: minutesAgo(3), crmErasedAt: null, attempts: 1 },
      { id: "just-erased", erasedAt: minutesAgo(1), crmErasedAt: null, attempts: 0 },
      { id: "done", erasedAt: minutesAgo(30), crmErasedAt: minutesAgo(29), attempts: 1 },
      { id: "given-up", erasedAt: minutesAgo(90), crmErasedAt: null, attempts: MAX_SYNC_ATTEMPTS },
    ];
    for (const person of people) {
      await insertPerson(person.id, `erased:${person.id}`);
      await env.DB.prepare("UPDATE people SET erased_at = ?, crm_erased_at = ?, crm_erasure_attempts = ? WHERE id = ?")
        .bind(person.erasedAt, person.crmErasedAt, person.attempts, person.id)
        .run();
    }
    const { bindings, queues } = sweepEnv();

    const summary = await sweep(bindings, fakeDependencies(), createLogger(), OPTIONS);

    expect(summary.erasuresRequeued).toBe(1);
    expect(queues.crm.sent).toEqual([{ erase_person_id: "pending", request_id: "sweeper" }]);
  });
});

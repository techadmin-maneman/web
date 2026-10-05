// The real Worker entry point, as Cloudflare calls it: fetch, queue, scheduled.

import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastCompletedAt } from "../../../src/domain/cron-runs.ts";
import worker from "../../../src/index.ts";
import { fakeBatch } from "../batches.ts";
import { captureLogs, countRowsRead, fakeQueue, markDatabase } from "../helpers.ts";
import { insertJob, insertPerson, syntheticJpeg } from "../tryon-fixtures.ts";

beforeEach(() => {
  captureLogs();
});

async function booksPaymentOf(paymentId: string): Promise<string | null> {
  return env.DB.prepare("SELECT books_payment_id FROM payments WHERE id = ?1")
    .bind(paymentId)
    .first<string | null>("books_payment_id");
}

/** What the runbook's first step of a restore writes. */
async function switchMaintenanceOn(startedAt: string): Promise<void> {
  await env.DB.prepare("INSERT INTO maintenance (id, reason, started_at) VALUES (1, 'restoring D1', ?1)")
    .bind(startedAt)
    .run();
}

describe("queue handler", () => {
  it("routes crm-sync messages to the sync, which marks the lead synced", async () => {
    await markDatabase();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-21T00:00:00Z', '+919810000001', 'A', 1)",
      ),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, request_id)
         VALUES ('0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01', 'p1', '2026-09-21T00:00:00Z', 'form', 'Gurgaon', 'weekday_am', 'crown', 'r')`,
      ),
    ]);
    const batch = fakeBatch("mm-crm-sync-local", [
      { lead_id: "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01", request_id: "r" },
    ]);

    await worker.queue(batch, env);

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    const lead = await env.DB.prepare("SELECT sync_state FROM leads").first();
    expect(lead).toEqual({ sync_state: "synced" }); // the local stub CRM
  });

  it("routes render messages to the render consumer, which submits the job to the stub", async () => {
    await markDatabase();
    const jobId = "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a02";
    await insertJob({
      id: jobId,
      state: "queued",
      stage: "crown",
      preset: "full-natural-short",
      hair_color: "black",
      endpoint: "pro",
      provider_color: "black",
      color_route: "as_detected",
      uploaded_at: "2026-09-21T00:00:00Z",
    });
    await env.UPLOADS.put(`uploads/${jobId}`, syntheticJpeg(800, 800));
    const batch = fakeBatch("mm-render-local", [{ job_id: jobId, request_id: "r" }]);

    await worker.queue(batch, env);

    expect(batch.messages[0]?.retry).toHaveBeenCalledWith({ delaySeconds: 5 });
    expect(await env.DB.prepare("SELECT state FROM tryon_jobs").first()).toEqual({ state: "rendering" });
  });

  it("routes messaging messages to the messaging consumer, which sends through the stub", async () => {
    await markDatabase();
    const messageId = "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a03";
    await insertPerson("p1", "+919810000001");
    await insertJob({ id: "job", state: "ready", result_key: "results/job.png" });
    await env.DB.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_id, state, queued_at)
       VALUES (?, '2026-09-21T00:00:00Z', 'p1', 'tryon_result', 'job', 'queued', '2026-09-21T00:00:00Z')`,
    )
      .bind(messageId)
      .run();
    const batch = fakeBatch("mm-messaging-local", [{ message_id: messageId, request_id: "r" }]);

    await worker.queue(batch, env);

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT state FROM outbound_messages").first()).toEqual({ state: "sent" });
  });

  it("ends each batch with a line saying what it cost D1", async () => {
    await markDatabase();
    const leadId = "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a04";
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-21T00:00:00Z', '+919810000001', 'A', 1)",
      ),
      env.DB.prepare(
        `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, request_id)
         VALUES (?1, 'p1', '2026-09-21T00:00:00Z', 'form', 'Gurgaon', 'weekday_am', 'crown', 'r')`,
      ).bind(leadId),
    ]);
    const logs = captureLogs();
    const rowsRead = countRowsRead();
    const batch = fakeBatch("mm-crm-sync-local", [{ lead_id: leadId, request_id: "r" }]);

    await worker.queue(batch, env);
    const summary = logs.lines().find((line) => line.event === "queue_batch");
    const read = rowsRead();
    vi.restoreAllMocks();

    expect(summary).toMatchObject({ queue: "mm-crm-sync-local", messages: 1, d1_rows_read: read });
    expect(summary?.d1_rows_written).toBeGreaterThan(0);
    expect(summary?.d1_queries).toBeGreaterThan(1);
  });

  it("retries messages from a queue it does not know", async () => {
    await markDatabase();
    const batch = fakeBatch("mm-mystery-local", [{}]);
    await worker.queue(batch, env);
    expect(batch.retryAll).toHaveBeenCalledOnce();
  });

  it("turns a batch away while D1 is being restored, to be delivered again in five minutes", async () => {
    await markDatabase();
    await switchMaintenanceOn(new Date().toISOString());
    const batch = fakeBatch("mm-crm-sync-local", [{ lead_id: "lead-1", request_id: "r" }]);

    await worker.queue(batch, env);

    expect(batch.retryAll).toHaveBeenCalledWith({ delaySeconds: 300 });
    expect(batch.messages[0]?.ack).not.toHaveBeenCalled();
  });
});

describe("scheduled handler while D1 is being restored", () => {
  const queues = {
    CRM_QUEUE: fakeQueue(),
    RENDER_QUEUE: fakeQueue(),
    MESSAGE_QUEUE: fakeQueue(),
  };

  it("runs no job and notes no run", async () => {
    await markDatabase();
    await switchMaintenanceOn(new Date().toISOString());
    const logs = captureLogs();

    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), { ...env, ...queues });

    expect(logs.lines().some((line) => line.event === "cron_run")).toBe(false);
    expect(logs.lines().some((line) => line.event === "cron_stopped_for_maintenance")).toBe(true);
    expect(await lastCompletedAt(env.DB)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS alerts FROM alerts").first()).toEqual({ alerts: 0 });
  });

  it("tells ops once the switch has been on for an hour", async () => {
    await markDatabase();
    const startedAt = new Date(Date.now() - 61 * 60_000).toISOString();
    await switchMaintenanceOn(startedAt);

    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), { ...env, ...queues });

    const alert = await env.DB.prepare("SELECT key, message FROM alerts").first<{ key: string; message: string }>();
    expect(alert?.key).toBe(`maintenance:${startedAt}`);
    expect(alert?.message).toContain('switch it off: runbook, "Restoring D1"');
  });
});

describe("scheduled handler", () => {
  it("runs the jobs, and notes the run as finished", async () => {
    await markDatabase();
    const logs = captureLogs();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), {
      ...env,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
    });
    expect(logs.lines().find((line) => line.event === "cron_run")).toMatchObject({ failed_jobs: [] });
    expect(await lastCompletedAt(env.DB)).not.toBeNull();
  });

  // D-01 of 4 October 2026: one run of every job took 34 to 61 ms of CPU on staging, past the free plan's 10.
  it("on the every-minute trigger, runs only the jobs due in the minute it was scheduled for", async () => {
    await markDatabase();
    const logs = captureLogs();
    const eightPast = Date.UTC(2026, 9, 4, 6, 8);
    await worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: eightPast }), {
      ...env,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
    });
    const summary = logs.lines().find((line) => line.event === "cron_run");
    expect(Object.keys(summary?.d1_rows_read_by_job as object)).toEqual(["unbooked_holds", "books_sync"]);
  });

  it("ends the run with a line saying what it cost D1, and what each job read of it", async () => {
    await markDatabase();
    const logs = captureLogs();
    const rowsRead = countRowsRead();

    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), {
      ...env,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
    });
    const summary = logs.lines().find((line) => line.event === "cron_run");
    const read = rowsRead();
    vi.restoreAllMocks();

    expect(summary).toMatchObject({ job: "cron", failed_jobs: [], d1_rows_read: read });
    expect(summary?.d1_rows_written).toBeGreaterThan(0);
    const byJob = summary?.d1_rows_read_by_job as Record<string, number>;
    expect(Object.keys(byJob)).toEqual(expect.arrayContaining(["requeue_leads", "referrals", "books_sync"]));
    const jobsRead = Object.values(byJob).reduce((total, rows) => total + rows, 0);
    expect(jobsRead).toBeGreaterThan(0);
    expect(jobsRead).toBeLessThanOrEqual(read);
  });

  it("offers captured payments to Books", async () => {
    await markDatabase();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p-1', ?1, '+919810000001', 'Rohit Malhotra')",
    )
      .bind(now)
      .run();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, status, captured_at, created_at,
         updated_at)
       VALUES ('pay-1', 'p-1', 'pay_test1', 200000, 'INR', 'captured', ?1, ?1, ?1)`,
    )
      .bind(now)
      .run();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), {
      ...env,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
    });
    // The pass makes the client's customer in the stub Books and records the payment there.
    expect(await booksPaymentOf("pay-1")).not.toBeNull();
  });

  it("runs every other job when one fails, and logs the one that failed", async () => {
    await markDatabase();
    const logs = captureLogs();
    const now = new Date().toISOString();
    const ninetyMinutesAgo = new Date(Date.now() - 90 * 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p-1', ?1, '+919810000001', 'Rohit Malhotra')",
      ).bind(now),
      env.DB.prepare(
        `INSERT INTO payments (id, person_id, razorpay_payment_id, amount, currency, status, captured_at, created_at,
           updated_at)
         VALUES ('pay-1', 'p-1', 'pay_test1', 200000, 'INR', 'captured', ?1, ?1, ?1)`,
      ).bind(now),
    ]);
    // A photo past keeping, in a bucket that will not delete it: that job fails.
    await insertJob({ id: "job-1", state: "ready", uploaded_at: ninetyMinutesAgo, created_at: ninetyMinutesAgo });
    const uploadsDown = { delete: () => Promise.reject(new Error("bucket unavailable")) } as unknown as R2Bucket;

    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), {
      ...env,
      UPLOADS: uploadsDown,
      CRM_QUEUE: fakeQueue(),
      RENDER_QUEUE: fakeQueue(),
      MESSAGE_QUEUE: fakeQueue(),
    });

    expect(logs.lines().filter((line) => line.event === "cron_job_failed")).toEqual([
      expect.objectContaining({ level: "error", job: "delete_photos" }),
    ]);
    expect(await booksPaymentOf("pay-1")).not.toBeNull();
  });
});

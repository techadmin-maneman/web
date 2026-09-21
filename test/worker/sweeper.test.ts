import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/log.ts";
import { MAX_SYNC_ATTEMPTS } from "../../src/queues/crm-sync.ts";
import { sweep } from "../../src/scheduled/sweeper.ts";
import { NOW, captureLogs, fakeDependencies, fakeQueue, markDatabase } from "./helpers.ts";

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

async function insertLead(id: string, state: string, attempts: number, createdAt: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p', ?, '+919810000001', 'A', 1)",
  )
    .bind(createdAt)
    .run();
  await env.DB.prepare(
    `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, sync_state, sync_attempts, request_id)
     VALUES (?, 'p', ?, 'form', 'Gurgaon', 'weekday_am', 'crown', ?, ?, 'r')`,
  )
    .bind(id, createdAt, state, attempts)
    .run();
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
});

describe("sweeper", () => {
  it("re-enqueues pending leads older than two minutes and failed leads with attempts left", async () => {
    await insertLead("pending-old", "pending", 0, minutesAgo(3));
    await insertLead("pending-new", "pending", 0, minutesAgo(1)); // its queue message is probably still on the way
    await insertLead("failed-retry", "failed", 4, minutesAgo(30));
    await insertLead("failed-final", "failed", MAX_SYNC_ATTEMPTS, minutesAgo(90));
    await insertLead("synced", "synced", 1, minutesAgo(60));
    const queue = fakeQueue();

    const summary = await sweep(env.DB, queue, fakeDependencies(), createLogger());

    expect(summary.leadsRequeued).toBe(2);
    expect(queue.sent).toEqual([
      { lead_id: "failed-retry", request_id: "sweeper" },
      { lead_id: "pending-old", request_id: "sweeper" },
    ]);
  });

  it("sends nothing when there is nothing to retry", async () => {
    const queue = fakeQueue();
    expect((await sweep(env.DB, queue, fakeDependencies(), createLogger())).leadsRequeued).toBe(0);
    expect(queue.sent).toEqual([]);
  });

  it("removes idempotency records older than a day and counters older than three days", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('old', 'r', 'h', ?)").bind(
        minutesAgo(25 * 60),
      ),
      env.DB.prepare("INSERT INTO idempotency (key, route, request_hash, created_at) VALUES ('new', 'r', 'h', ?)").bind(
        minutesAgo(60),
      ),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-17', 1)"),
      env.DB.prepare("INSERT INTO counters (scope, key, window_start, count) VALUES ('s', 'k', '2026-09-20T10', 1)"),
    ]);

    await sweep(env.DB, fakeQueue(), fakeDependencies(), createLogger());

    const keys = await env.DB.prepare("SELECT key FROM idempotency").all();
    expect(keys.results).toEqual([{ key: "new" }]);
    const windows = await env.DB.prepare("SELECT window_start FROM counters").all();
    expect(windows.results).toEqual([{ window_start: "2026-09-20T10" }]);
  });
});

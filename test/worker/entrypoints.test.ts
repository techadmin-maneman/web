// The real Worker entry point, as Cloudflare calls it: fetch, queue, scheduled.

import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/index.ts";
import { CitySchema } from "../../src/routes/cities.ts";
import { captureLogs, fakeQueue, markDatabase } from "./helpers.ts";

beforeEach(() => {
  captureLogs();
});

function queueBatch(queue: string, bodies: unknown[]) {
  const messages = bodies.map((body, index) => ({
    id: `m-${String(index)}`,
    body,
    attempts: 1,
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  return { queue, messages, ackAll: vi.fn(), retryAll: vi.fn() };
}

describe("GET /api/cities", () => {
  it("lists active cities in display order, cacheable for five minutes", async () => {
    await markDatabase();
    await env.DB.prepare("UPDATE cities SET active = 0 WHERE name = 'Bengaluru'").run();

    const res = await worker.fetch(new Request("https://maneman.test/api/cities"), env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const cities = CitySchema.array().parse(await res.json());
    expect(cities).toEqual([
      { name: "Gurgaon", served: true },
      { name: "Delhi", served: true },
      { name: "Noida", served: true },
      { name: "Faridabad", served: true },
      { name: "Ghaziabad", served: true },
      { name: "Mumbai", served: false },
    ]);
  });
});

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
    const batch = queueBatch("mm-crm-sync-local", [
      { lead_id: "0b9f1a52-7c0b-4f5b-9a0e-2f4f6f2b1a01", request_id: "r" },
    ]);

    await worker.queue(batch as unknown as MessageBatch, env);

    expect(batch.messages[0]?.ack).toHaveBeenCalledOnce();
    const lead = await env.DB.prepare("SELECT sync_state FROM leads").first();
    expect(lead).toEqual({ sync_state: "synced" }); // the local stub CRM
  });

  it("retries messages from a queue it does not know", async () => {
    await markDatabase();
    const batch = queueBatch("mm-mystery-local", [{}]);
    await worker.queue(batch as unknown as MessageBatch, env);
    expect(batch.retryAll).toHaveBeenCalledOnce();
  });
});

describe("scheduled handler", () => {
  it("runs the sweeper", async () => {
    await markDatabase();
    const logs = captureLogs();
    await worker.scheduled(createScheduledController({ cron: "*/5 * * * *" }), { ...env, CRM_QUEUE: fakeQueue() });
    expect(logs.lines().some((line) => line.event === "sweep")).toBe(true);
  });
});

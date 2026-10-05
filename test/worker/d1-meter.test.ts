// What a piece of work costs D1, summed from what D1 reports of each statement it ran, and how long it waited on D1
// (src/lib/d1-meter.ts).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { meterDatabase, serverTiming, usageFields, usageSince } from "../../src/lib/d1-meter.ts";
import { countRowsRead } from "./helpers.ts";

const PEOPLE = ["p-1", "p-2", "p-3"];

beforeEach(async () => {
  await env.DB.batch(
    PEOPLE.map((id, index) =>
      env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, ?3, ?4)").bind(
        id,
        "2026-09-21T00:00:00Z",
        `+91981000000${String(index)}`,
        `Client ${String(index)}`,
      ),
    ),
  );
});

describe("a metered database", () => {
  it("counts the rows read and written, and the statements, of run, all, first and batch alike", async () => {
    const meter = meterDatabase(env.DB);
    const { db } = meter;

    const all = await db.prepare("SELECT id FROM people").all();
    const first = await db.prepare("SELECT id FROM people WHERE id = ?1").bind("p-2").first<{ id: string }>();
    const run = await db.prepare("UPDATE people SET name = 'Renamed' WHERE id = ?1").bind("p-1").run();
    const batched = await db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM people"),
      db.prepare("DELETE FROM people WHERE id = ?1").bind("p-3"),
    ]);

    expect(all.results).toHaveLength(3);
    expect(first).toEqual({ id: "p-2" });
    expect(batched.map((result) => result.results)).toEqual([[{ n: 3 }], []]);
    const reported = [all, run, ...batched];
    const usage = meter.usage();
    expect(usage.queries).toBe(5);
    expect(usage.rowsRead).toBeGreaterThan(sum(reported, "rows_read"));
    expect(usage.rowsWritten).toBe(sum(reported, "rows_written"));
    expect(usage.rowsWritten).toBeGreaterThan(0);
  });

  it("reads what the test suite's own count of rows read does", async () => {
    const counted = countRowsRead();
    const meter = meterDatabase(env.DB);

    await meter.db.prepare("SELECT id FROM people").all();
    await meter.db.prepare("SELECT name FROM people WHERE id = ?1").bind("p-1").first("name");
    await meter.db.batch([meter.db.prepare("SELECT 1 FROM people")]);

    expect(meter.usage().rowsRead).toBe(counted());
  });

  it("answers first() as D1 does: the row, one column of it, or null", async () => {
    const { db } = meterDatabase(env.DB);
    const byId = db.prepare("SELECT id, name FROM people WHERE id = ?1");

    expect(await byId.bind("p-1").first()).toEqual({ id: "p-1", name: "Client 0" });
    expect(await byId.bind("p-1").first("name")).toBe("Client 0");
    expect(await byId.bind("nobody").first()).toBeNull();
    await expect(byId.bind("p-1").first("mobile")).rejects.toThrow("D1_COLUMN_NOTFOUND");
  });

  it("keeps each meter to its own work", async () => {
    const one = meterDatabase(env.DB);
    const other = meterDatabase(env.DB);

    await one.db.prepare("SELECT id FROM people").all();

    expect(one.usage().queries).toBe(1);
    expect(other.usage()).toEqual({ rowsRead: 0, rowsWritten: 0, queries: 0 });
  });

  it("counts a statement a stand-in database says nothing of as one that read nothing", async () => {
    const statement = { all: () => Promise.resolve({ results: [] }) };
    const silent = { prepare: () => statement } as unknown as D1Database;
    const meter = meterDatabase(silent);

    await meter.db.prepare("SELECT 1").all();

    expect(meter.usage()).toEqual({ rowsRead: 0, rowsWritten: 0, queries: 1 });
  });

  it("counts statements sent together as one round trip, and statements sent one after another as one each", async () => {
    const meter = meterDatabase(env.DB);
    const { db } = meter;

    await Promise.all([
      db.prepare("SELECT id FROM people").all(),
      db.prepare("SELECT name FROM people WHERE id = ?1").bind("p-1").first(),
      db.batch([db.prepare("SELECT 1")]),
    ]);
    await db.prepare("SELECT id FROM people").all();
    await db.prepare("UPDATE people SET name = 'Renamed' WHERE id = ?1").bind("p-1").run();

    expect(meter.waits().trips).toBe(3);
    expect(meter.usage().queries).toBe(5);
    expect(meter.waits().ms).toBeGreaterThanOrEqual(0);
  });

  it("gives the waits as a Server-Timing entry", () => {
    expect(serverTiming({ trips: 4, ms: 380 })).toBe('d1;dur=380;desc="4 round trips"');
  });

  it("gives the usage as log fields, and what changed between two readings", () => {
    const before = { rowsRead: 10, rowsWritten: 1, queries: 2 };
    const after = { rowsRead: 25, rowsWritten: 1, queries: 5 };

    expect(usageSince(before, after)).toEqual({ rowsRead: 15, rowsWritten: 0, queries: 3 });
    expect(usageFields(after)).toEqual({ d1_rows_read: 25, d1_rows_written: 1, d1_queries: 5 });
  });
});

function sum(results: readonly D1Result[], field: "rows_read" | "rows_written"): number {
  return results.reduce((total, result) => total + result.meta[field], 0);
}

// A lost connection failed a cron job, threw a consumer batch and answered a client 500, all seconds before
// D1 would have answered.
describe("a read D1 fails for a reason that passes by itself", () => {
  /** A database whose statements fail `failures` times with `message`, then work. */
  function flaky(failures: number, message = "D1_ERROR: Network connection lost."): D1Database {
    let left = failures;
    const failOrSend = <T>(send: () => Promise<T>) => {
      if (left <= 0) return send();
      left -= 1;
      return Promise.reject(new Error(message));
    };
    const statement = (real: D1PreparedStatement): D1PreparedStatement =>
      ({
        bind: (...values: unknown[]) => statement(real.bind(...values)),
        all: () => failOrSend(() => real.all()),
        run: () => failOrSend(() => real.run()),
      }) as unknown as D1PreparedStatement;
    return { prepare: (query: string) => statement(env.DB.prepare(query)) } as unknown as D1Database;
  }

  it("is read again, and answers", async () => {
    const { db } = meterDatabase(flaky(2));
    expect((await db.prepare("SELECT id FROM people").all()).results).toHaveLength(3);
  });

  it("is not tried again for a write, nor for a failure that does not pass", async () => {
    await expect(meterDatabase(flaky(1)).db.prepare("UPDATE people SET name = 'x'").run()).rejects.toThrow("lost");
    await expect(
      meterDatabase(flaky(1)).db.prepare("INSERT INTO people (id) VALUES ('p-9') RETURNING id").all(),
    ).rejects.toThrow("lost");
    const missing = flaky(1, "D1_ERROR: no such table: nowhere");
    await expect(meterDatabase(missing).db.prepare("SELECT id FROM people").all()).rejects.toThrow("no such table");
  });

  it("gives up after its tries", async () => {
    await expect(meterDatabase(flaky(5)).db.prepare("SELECT id FROM people").all()).rejects.toThrow("lost");
  });
});

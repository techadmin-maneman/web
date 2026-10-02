// What a piece of work costs D1, summed from what D1 reports of each statement it ran (src/lib/d1-meter.ts).

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { meterDatabase, usageFields, usageSince } from "../../src/lib/d1-meter.ts";
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

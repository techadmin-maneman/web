import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { markDatabase } from "../helpers.ts";

// These tests run in order: the second of each pair checks that what the first left behind is gone.

interface Snapshot {
  schema: unknown[];
  triggers: unknown[];
  rows: unknown[][];
}

let migrated: Snapshot;

beforeAll(async () => {
  migrated = await snapshot();
});

/** The schema, the order the triggers were made in, and every row. */
async function snapshot(): Promise<Snapshot> {
  const schema = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT GLOB '_cf_*' ORDER BY type, name",
  ).all<{ type: string; name: string; sql: string | null }>();
  const triggers = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY rowid").all();
  const tables = schema.results.filter(
    (entry) => entry.type === "table" && entry.name !== "d1_migrations" && !entry.name.startsWith("sqlite_"),
  );
  const rows = await env.DB.batch(tables.map((table) => env.DB.prepare(`SELECT * FROM "${table.name}"`)));
  return { schema: schema.results, triggers: triggers.results, rows: rows.map((result) => result.results) };
}

function buckets(): R2Bucket[] {
  return [env.UPLOADS, env.RESULTS, env.CLIENT_PHOTOS, env.REFERRAL_CARDS];
}

describe("each worker test's starting point", () => {
  it("is the database as the migrations left it", async () => {
    expect(await snapshot()).toEqual(migrated);
  });

  it("lets a test write rows, append-only ones too, change seeded rows and fill every bucket", async () => {
    await markDatabase();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p-1', ?1, '+919810000001', 'Arjun Mehta', 1)",
      ).bind("2026-10-01T09:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES ('c-1', 'p-1', 'contact', 'booking-v1', 1, ?1)`,
      ).bind("2026-10-01T09:00:00.000Z"),
      env.DB.prepare("DELETE FROM price_book"),
      env.DB.prepare("UPDATE cities SET served = 0"),
    ]);
    await Promise.all(buckets().map((bucket) => bucket.put("left-behind.txt", "left behind")));

    expect(await snapshot()).not.toEqual(migrated);
  });

  it("has none of that in the next test, and the append-only triggers still refuse", async () => {
    expect(await snapshot()).toEqual(migrated);
    for (const bucket of buckets()) {
      expect((await bucket.list()).objects).toEqual([]);
    }

    await markDatabase();
    await expect(env.DB.prepare("DELETE FROM deployment_identity").run()).rejects.toThrow(
      "deployment_identity is immutable",
    );
  });

  it("lets a test drop a table and add a trigger", async () => {
    await env.DB.exec("DROP TABLE deployment_identity");
    await env.DB.exec("CREATE TRIGGER refuse_people BEFORE INSERT ON people BEGIN SELECT RAISE(ABORT, 'refused'); END");

    expect(await snapshot()).not.toEqual(migrated);
  });

  // The migrations ran again, and services.updated_at holds the time they ran, so only the schema is compared.
  it("has the migrated schema back in the next test", async () => {
    const { schema, triggers } = await snapshot();

    expect({ schema, triggers }).toEqual({ schema: migrated.schema, triggers: migrated.triggers });
  });
});

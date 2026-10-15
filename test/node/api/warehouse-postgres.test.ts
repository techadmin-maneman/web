// The reporting copy on a real Postgres made from its migrations (warehouse/migrations), in this process: the
// migrations themselves, the writer's statements run on that schema, and a whole night copied by the nightly job
// from a database of one of every record, as the API's own role, then read as Zoho's.

import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyticsSeed, COPY_TABLES } from "../../../scripts/lib/analytics-seed.ts";
import { migratedWarehouse, postgresOn } from "../../../scripts/lib/pglite.ts";
import {
  markApplied,
  migrate,
  schemaShape,
  shapeDiff,
  warehouseMigrations,
} from "../../../scripts/lib/warehouse-migrations.ts";
import { copyTonight } from "../../../src/domain/analytics/nightly.ts";
import type { Row, TableRows } from "../../../src/providers/warehouse/index.ts";
import { warehouseOn } from "../../../src/providers/warehouse/supabase.ts";
import { indiaDate } from "../../../src/lib/india-time.ts";
import { asD1, migratedDatabase } from "../d1-over-sqlite.ts";
import { sqlOn } from "../pglite.ts";

let migrated: PGlite;
let pg: PGliteInterface;

// Made once, then copied for each test, so a test starts from the bare schema without migrating again.
beforeAll(async () => {
  migrated = await migratedWarehouse();
});

beforeEach(async () => {
  pg = await migrated.clone();
});

const count = async (table: string) =>
  (await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]?.n;

describe("the copy's migrations", () => {
  it("make every table the night writes, and Zoho's view of each", async () => {
    for (const table of COPY_TABLES) {
      expect(await count(`analytics.${table}`), table).toBe(0);
      expect(await count(`reporting.${table}`), table).toBe(0);
    }
  });

  it("are each applied once", async () => {
    expect(await migrate(postgresOn(pg), warehouseMigrations())).toEqual([]);
  });

  // The analytics project's schema was made by hand before the files were.
  it("can be recorded as applied on a schema made before them, running none, and then apply the rest", async () => {
    const [first] = warehouseMigrations();
    const byHand = postgresOn(await PGlite.create());
    await byHand.exec(first?.sql ?? "");
    expect(await markApplied(byHand, warehouseMigrations(), "0001_analytics_schema")).toEqual([
      "0001_analytics_schema",
    ]);
    expect(await migrate(byHand, warehouseMigrations())).toEqual(["0002_reporting_on_the_copy"]);
    await expect(markApplied(byHand, warehouseMigrations(), "0099_none")).rejects.toThrow("no migration is named");
  });

  it("show a column a database has that they do not make, and one they make that it lacks", async () => {
    const made = await schemaShape(postgresOn(pg));
    await pg.exec(
      "ALTER TABLE analytics.dim_city ADD COLUMN state text; ALTER TABLE analytics.dim_city DROP COLUMN zone CASCADE",
    );
    expect(shapeDiff(made, await schemaShape(postgresOn(pg)))).toEqual([
      "only in the migrations: dim_city.zone text",
      "only in the database: dim_city.state text",
    ]);
  });

  it("let the writer work the copy and nothing else, and Zoho read it and nothing else", async () => {
    await pg.exec("SET ROLE analytics_writer");
    await pg.exec("INSERT INTO analytics.dim_city (city, served, active) VALUES ('Gurgaon', true, true)");
    await expect(pg.exec("CREATE TABLE analytics.extra (id text)")).rejects.toThrow(/permission denied/);
    await pg.exec("RESET ROLE; SET ROLE zoho_reader");
    expect(await count("reporting.dim_city")).toBe(1);
    await expect(pg.exec("DELETE FROM analytics.dim_city")).rejects.toThrow(/permission denied/);
  });
});

const RUN = "run-1";

const clients = (...rows: Row[]): TableRows => ({ table: "dim_client", key: ["client_key"], rows, stamped: true });
const client = (key: string, channel: string): Row => ({ client_key: key, channel, referred: false });

const stamps = async () =>
  (await pg.query<{ client_key: string; updated_at: Date }>("SELECT client_key, updated_at FROM analytics.dim_client"))
    .rows;

describe("a night's swap, on the copy's own schema", () => {
  const night = async (...tables: TableRows[]) => {
    const warehouse = warehouseOn(sqlOn(pg));
    const staged = [];
    for (const table of tables) staged.push(await warehouse.stage(RUN, table));
    return warehouse.swap(RUN, staged);
  };

  it("writes new rows, and leaves nothing staged behind", async () => {
    expect(await night(clients(client("c1", "google"), client("c2", "referral")))).toEqual({ written: 2, changed: 2 });
    expect(await count("analytics.dim_client")).toBe(2);
    expect(await count("analytics.load_rows")).toBe(0);
  });

  it("stamps only the row whose values changed", async () => {
    await night(clients(client("c1", "google"), client("c2", "referral")));
    await pg.exec("UPDATE analytics.dim_client SET updated_at = '2026-01-01T00:00:00Z'");
    expect(await night(clients(client("c1", "google"), client("c2", "meta")))).toEqual({ written: 2, changed: 1 });
    const stamped = Object.fromEntries((await stamps()).map((row) => [row.client_key, row.updated_at.toISOString()]));
    expect(stamped.c1).toBe("2026-01-01T00:00:00.000Z");
    expect(stamped.c2).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("deletes a row the night no longer works out", async () => {
    await night(clients(client("c1", "google"), client("c2", "referral")));
    await night(clients(client("c2", "referral")));
    expect((await stamps()).map((row) => row.client_key)).toEqual(["c2"]);
  });

  it("keeps a table's rows before its date as an earlier night wrote them", async () => {
    const day = (date: string, taken: number): Row => ({
      day: date,
      technician_key: "t1",
      city: "Gurgaon",
      half_slots_open: 8,
      half_slots_taken: taken,
      on_leave: false,
    });
    const capacity = (from: string, ...rows: Row[]): TableRows => ({
      table: "fact_capacity",
      key: ["day", "technician_key"],
      rows,
      stamped: true,
      keepBefore: { column: "day", from },
    });
    await night(capacity("2026-10-01", day("2026-10-01", 2), day("2026-10-02", 3)));
    await night(capacity("2026-10-02", day("2026-10-02", 5)));
    const days = await pg.query<{ day: Date; half_slots_taken: number }>(
      "SELECT day, half_slots_taken FROM analytics.fact_capacity ORDER BY day",
    );
    expect(days.rows.map((row) => [indiaDate(row.day), row.half_slots_taken])).toEqual([
      ["2026-10-01", 2],
      ["2026-10-02", 5],
    ]);
  });

  it("adds nothing more to a row that is all key", async () => {
    await pg.exec("CREATE TABLE analytics.pairs (a text, b text, PRIMARY KEY (a, b))");
    const pairs: TableRows = { table: "pairs", key: ["a", "b"], rows: [{ a: "x", b: "y" }], stamped: false };
    expect(await night(pairs)).toEqual({ written: 1, changed: 1 });
    expect(await night(pairs)).toEqual({ written: 1, changed: 0 });
  });

  it("fails a row with a column the schema does not have, rather than dropping it", async () => {
    await expect(night(clients({ ...client("c1", "google"), first_city: "Gurgaon" }))).rejects.toThrow(/first_city/);
  });
});

describe("a whole night, by the nightly job", () => {
  const now = new Date();
  const d1 = () => {
    const db = migratedDatabase();
    db.exec(analyticsSeed(now));
    return asD1(db);
  };

  // A column the job sends that no migration made, or a grant the writer lacks, fails here, not at 3 am in production.
  it("fills every table as the writer, changes nothing the second time, and Zoho reads it all", async () => {
    const database = d1();
    await pg.exec("SET ROLE analytics_writer");
    const given = { secret: "a".repeat(64), date: indiaDate(now), now: () => new Date() };
    const first = await copyTonight(database, warehouseOn(sqlOn(pg)), given);
    const second = await copyTonight(database, warehouseOn(sqlOn(pg)), given);
    expect(first.totalsChecked).toBe(true);
    expect(first.rowsChanged).toBeGreaterThan(0);
    expect(second.rowsChanged).toBe(0);
    const warehouse = warehouseOn(sqlOn(pg));
    expect(await warehouse.ranOn(given.date)).toBe(true);
    expect(await warehouse.ranOn("2020-01-01")).toBe(false);
    await warehouse.close();
    await pg.exec("RESET ROLE; SET ROLE zoho_reader");
    const empty = [];
    for (const table of COPY_TABLES) if ((await count(`reporting.${table}`)) === 0) empty.push(table);
    expect(empty).toEqual([]);
  });
});

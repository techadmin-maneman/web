import { applyD1Migrations, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach } from "vitest";

// Every test starts from an empty, fully migrated, UNMARKED database and empty buckets. Tests
// that need a healthy Worker call markDatabase() themselves.
//
// Applying the migrations takes about a second, so a file applies them once and remembers what
// they left. Each test then gets that back in one batch; a test that changed the schema itself
// (dropped a table, added a trigger) makes the next one apply the migrations again.

interface Trigger {
  name: string;
  sql: string;
}

interface TableRows {
  table: string;
  rows: Record<string, unknown>[];
}

interface MigratedState {
  schema: string;
  tables: string[];
  triggers: Trigger[];
  seedRows: TableRows[];
}

let migrated: MigratedState;

beforeAll(async () => {
  await migrateFromScratch();
  migrated = await readMigratedState();
});

beforeEach(async () => {
  if ((await readSchema()) !== migrated.schema) {
    await migrateFromScratch();
    return;
  }
  await restoreRows(migrated);
  await emptyBuckets();
});

async function migrateFromScratch(): Promise<void> {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
}

async function readSchema(): Promise<string> {
  const entries = await env.DB.prepare(
    "SELECT type, name, sql FROM sqlite_master WHERE name NOT GLOB '_cf_*' ORDER BY type, name",
  ).raw();
  return JSON.stringify(entries);
}

async function readMigratedState(): Promise<MigratedState> {
  const tables = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations'`,
  ).all<{ name: string }>();
  const tableNames = tables.results.map((table) => table.name);
  // Creation order, which is the order SQLite fires a table's triggers in.
  const triggers = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY rowid",
  ).all<Trigger>();
  return {
    schema: await readSchema(),
    tables: tableNames,
    triggers: triggers.results,
    seedRows: await readRows(tableNames),
  };
}

async function readRows(tables: string[]): Promise<TableRows[]> {
  const results = await env.DB.batch<Record<string, unknown>>(
    tables.map((table) => env.DB.prepare(`SELECT * FROM "${table}"`)),
  );
  const tableRows = tables.map((table, index) => ({ table, rows: results[index]?.results ?? [] }));
  return tableRows.filter((entry) => entry.rows.length > 0);
}

async function restoreRows({ tables, triggers, seedRows }: MigratedState): Promise<void> {
  await env.DB.batch([
    // Foreign keys are checked when the batch commits, so tables empty and refill in any order.
    env.DB.prepare("PRAGMA defer_foreign_keys = on"),
    // Off while the rows are replaced: the append-only tables' triggers refuse a DELETE, and others write elsewhere.
    ...triggers.map((trigger) => env.DB.prepare(`DROP TRIGGER "${trigger.name}"`)),
    ...tables.map((table) => env.DB.prepare(`DELETE FROM "${table}"`)),
    ...seedRows.flatMap(insertStatements),
    ...triggers.map((trigger) => env.DB.prepare(trigger.sql)),
  ]);
}

function insertStatements({ table, rows }: TableRows): D1PreparedStatement[] {
  return rows.map((row) => {
    const columns = Object.keys(row);
    const names = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    return env.DB.prepare(`INSERT INTO "${table}" (${names}) VALUES (${placeholders})`).bind(...Object.values(row));
  });
}

async function emptyBuckets(): Promise<void> {
  const buckets = Object.values(env).filter(isBucket);
  await Promise.all(buckets.map(emptyBucket));
}

function isBucket(binding: unknown): binding is R2Bucket {
  return typeof binding === "object" && binding !== null && binding.constructor.name === "R2Bucket";
}

async function emptyBucket(bucket: R2Bucket): Promise<void> {
  let listed = await bucket.list();
  while (listed.objects.length > 0) {
    await bucket.delete(listed.objects.map((object) => object.key));
    listed = await bucket.list();
  }
}

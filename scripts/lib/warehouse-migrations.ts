// The reporting copy's schema as numbered migrations (warehouse/migrations/*.sql), applied in order, each in a
// transaction, and recorded in warehouse.migrations so none runs twice. A database whose schema was made before the
// files were can be marked as having applied them, after its shape is checked against theirs. Used by
// scripts/ops/warehouse-migrate.ts and scripts/ops/warehouse-check.ts, and by the tests on an in-process Postgres.

import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS_DIR = "warehouse/migrations";

export interface Migration {
  readonly name: string;
  readonly sql: string;
}

/** Every migration in the folder, in the order its numbers give. */
export function warehouseMigrations(directory: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(directory)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
    .sort()
    .map((file) => ({ name: file.replace(/\.sql$/, ""), sql: readFileSync(`${directory}/${file}`, "utf8") }));
}

/** The little of a Postgres client the migrations need, so the postgres package and PGlite both serve. */
export interface Postgres {
  /** Runs one or more statements, with no parameters. */
  exec(sql: string): Promise<void>;
  query<T>(sql: string, params?: readonly (string | number | boolean | null)[]): Promise<T[]>;
  transaction(work: (tx: Postgres) => Promise<void>): Promise<void>;
}

const RECORD = `CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE TABLE IF NOT EXISTS warehouse.migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());`;

export async function appliedMigrations(db: Postgres): Promise<string[]> {
  await db.exec(RECORD);
  const rows = await db.query<{ name: string }>("SELECT name FROM warehouse.migrations ORDER BY name");
  return rows.map((row) => row.name);
}

/** The migrations not yet applied, applied in order; their names. */
export async function migrate(db: Postgres, migrations: readonly Migration[]): Promise<string[]> {
  const applied = new Set(await appliedMigrations(db));
  const pending = migrations.filter((migration) => !applied.has(migration.name));
  for (const migration of pending) {
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query("INSERT INTO warehouse.migrations (name) VALUES ($1)", [migration.name]);
    });
  }
  return pending.map((migration) => migration.name);
}

/** Records the migrations up to and including `through` as applied, running none of them; their names. */
export async function markApplied(db: Postgres, migrations: readonly Migration[], through: string): Promise<string[]> {
  const upTo = migrations.findIndex((migration) => migration.name === through);
  if (upTo < 0) throw new Error(`no migration is named ${through}`);
  const names = migrations.slice(0, upTo + 1).map((migration) => migration.name);
  const applied = new Set(await appliedMigrations(db));
  for (const name of names.filter((each) => !applied.has(each))) {
    await db.query("INSERT INTO warehouse.migrations (name) VALUES ($1)", [name]);
  }
  return names;
}

/** Each column of the analytics schema's tables, and each table's primary key, as one line apiece. */
const SHAPE = `SELECT format('%s.%s %s%s%s', c.table_name, c.column_name, c.data_type,
         CASE WHEN c.is_nullable = 'NO' THEN ' not null' ELSE '' END,
         CASE WHEN c.column_default IS NULL THEN '' ELSE ' default ' || c.column_default END) AS line
  FROM information_schema.columns c WHERE c.table_schema = 'analytics'
UNION ALL
SELECT format('%s key (%s)', t.relname, string_agg(a.attname, ', ' ORDER BY k.n))
  FROM pg_constraint p
  JOIN pg_class t ON t.oid = p.conrelid
  CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY AS k(attnum, n)
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
  WHERE p.contype = 'p' AND p.connamespace = 'analytics'::regnamespace
  GROUP BY t.relname
ORDER BY 1`;

export async function schemaShape(db: Postgres): Promise<string[]> {
  return (await db.query<{ line: string }>(SHAPE)).map((row) => row.line);
}

/** What one shape has that the other lacks, each line marked with the side it is on. */
export function shapeDiff(migrated: readonly string[], live: readonly string[]): string[] {
  const inLive = new Set(live);
  const inMigrated = new Set(migrated);
  return [
    ...migrated.filter((line) => !inLive.has(line)).map((line) => `only in the migrations: ${line}`),
    ...live.filter((line) => !inMigrated.has(line)).map((line) => `only in the database: ${line}`),
  ];
}

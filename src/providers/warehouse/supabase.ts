// The reporting copy in Supabase's Postgres, through Hyperdrive (docs/decisions/0146-the-nightly-analytics-copy.md).
// Every table is in the analytics schema, which Supabase's Data API does not expose; the API writes as its own role.
// Rows go in batches of a few hundred, each upserted so an unchanged row keeps its updated_at, which is what lets Zoho
// fetch only what changed.

import postgres from "postgres";
import type { Cell, RunLog, TableRows, WarehouseProvider } from "./index.ts";

const SCHEMA = "analytics";

/** Rows to a statement: well inside Postgres's 65,535 parameters at our widest table. */
const BATCH = 300;

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * The upsert for one batch: new rows inserted, a row whose values differ updated and stamped, an unchanged row left as
 * it was. Answers one row for each written or changed, so the count of what it answers is what changed.
 */
export function upsertSql(table: string, key: readonly string[], columns: readonly string[], rows: number): string {
  const values = Array.from({ length: rows }, (_, row) => {
    const cells = columns.map((_, column) => `$${String(row * columns.length + column + 1)}`);
    return `(${cells.join(", ")})`;
  });
  const others = columns.filter((column) => !key.includes(column));
  const target = `${quoted(SCHEMA)}.${quoted(table)}`;
  const set = [...others.map((column) => `${quoted(column)} = excluded.${quoted(column)}`), `"updated_at" = now()`];
  const differs = `(${others.map((column) => `t.${quoted(column)}`).join(", ")}) IS DISTINCT FROM (${others
    .map((column) => `excluded.${quoted(column)}`)
    .join(", ")})`;
  return `INSERT INTO ${target} AS t (${columns.map(quoted).join(", ")}) VALUES ${values.join(", ")}
    ON CONFLICT (${key.map(quoted).join(", ")}) DO UPDATE SET ${set.join(", ")} WHERE ${differs}
    RETURNING 1`;
}

/** Deletes every row whose key is not among tonight's, the key's columns joined as text. */
export function staleSql(table: string, key: readonly string[]): string {
  const joined = key.map((column) => `${quoted(column)}::text`).join(` || '|' || `);
  return `DELETE FROM ${quoted(SCHEMA)}.${quoted(table)} WHERE NOT ((${joined}) = ANY($1::text[]))`;
}

export function createSupabaseWarehouse(connectionString: string): WarehouseProvider {
  // One connection, as Hyperdrive pools them; no prepared statements, which a pooler does not carry between clients.
  const sql = postgres(connectionString, { max: 1, prepare: false, fetch_types: false });
  return {
    ranOn: async (date) => {
      const found = await sql.unsafe(
        `SELECT 1 FROM ${SCHEMA}.load_run WHERE source = 'd1' AND ended_at IS NOT NULL
         AND notes LIKE $1 LIMIT 1`,
        [`date ${date}%`],
      );
      return found.length > 0;
    },
    replace: async ({ table, key, rows }: TableRows) => {
      let changed = 0;
      const columns = Object.keys(rows[0] ?? {});
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const params: Cell[] = batch.flatMap((row) => columns.map((column) => row[column] ?? null));
        const answered = await sql.unsafe(upsertSql(table, key, columns, batch.length), params as never[]);
        changed += answered.length;
      }
      const keys = rows.map((row) => key.map((column) => String(row[column])).join("|"));
      await sql.unsafe(staleSql(table, key), [keys] as never[]);
      return { written: rows.length, changed };
    },
    count: async (table) => {
      const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${SCHEMA}.${quoted(table)}`);
      return Number(row?.n ?? 0);
    },
    sum: async (table, column) => {
      const [row] = await sql.unsafe(
        `SELECT coalesce(sum(${quoted(column)}), 0)::float8 AS n FROM ${SCHEMA}.${quoted(table)}`,
      );
      return Number(row?.n ?? 0);
    },
    logRun: async (run: RunLog) => {
      await sql.unsafe(
        `INSERT INTO ${SCHEMA}.load_run (started_at, ended_at, source, rows_written, rows_changed, totals_checked,
           database_bytes, notes) VALUES ($1, $2, 'd1', $3, $4, $5, $6, $7)`,
        [
          run.startedAt.toISOString(),
          run.endedAt.toISOString(),
          run.rowsWritten,
          run.rowsChanged,
          run.totalsChecked,
          run.databaseBytes,
          `date ${run.date}${run.notes === null ? "" : ` · ${run.notes}`}`,
        ],
      );
    },
    size: async () => {
      const [row] = await sql.unsafe("SELECT pg_database_size(current_database())::float8 AS n");
      return Number(row?.n ?? 0);
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

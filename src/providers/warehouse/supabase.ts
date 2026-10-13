// The reporting copy in Supabase's Postgres, through Hyperdrive (docs/decisions/0146-the-nightly-analytics-copy.md,
// 0196-long-work-in-workflows.md). Every table is in the analytics schema, which Supabase's Data API does not expose; the
// API writes as its own role. A night stages each table's rows in load_rows, a step at a time, then swaps them all in
// one transaction: each row upserted so an unchanged one keeps its updated_at, which is what lets Zoho fetch only what
// changed, and each row not staged deleted.

import postgres from "postgres";
import {
  metaOf,
  rowKey,
  type Cell,
  type RunLog,
  type TableMeta,
  type TableRows,
  type WarehouseProvider,
} from "./index.ts";

const SCHEMA = "analytics";

/** Rows to a statement: well inside Postgres's 65,535 parameters. */
const BATCH = 300;

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

const STAGED = `${quoted(SCHEMA)}."load_rows"`;

/** One batch of a table's rows into load_rows, each as its key and its JSON: $1 the run, $2 the table, then pairs. */
export function stageSql(rows: number): string {
  const values = Array.from(
    { length: rows },
    (_, row) => `($1, $2, $${String(row * 2 + 3)}, ($${String(row * 2 + 4)}::text)::jsonb)`,
  );
  return `INSERT INTO ${STAGED} (run_id, table_name, key, row) VALUES ${values.join(", ")}`;
}

/**
 * A table's staged rows upserted into it: new rows inserted, a row whose values differ updated and stamped, an
 * unchanged row left as it was. $1 is the run, $2 the table. Answers one row for each new or changed.
 */
export function upsertSql({ table, key, stamped, columns }: TableMeta): string {
  const target = `${quoted(SCHEMA)}.${quoted(table)}`;
  const others = columns.filter((column) => !key.includes(column));
  const set = others.map((column) => `${quoted(column)} = excluded.${quoted(column)}`);
  if (stamped) set.push(`"updated_at" = now()`);
  const change =
    others.length === 0
      ? "DO NOTHING"
      : `DO UPDATE SET ${set.join(", ")} WHERE (${others.map((column) => `t.${quoted(column)}`).join(", ")}) ` +
        `IS DISTINCT FROM (${others.map((column) => `excluded.${quoted(column)}`).join(", ")})`;
  return `INSERT INTO ${target} AS t (${columns.map(quoted).join(", ")})
    SELECT ${columns.map((column) => `r.${quoted(column)}`).join(", ")}
    FROM ${STAGED} l, jsonb_populate_record(NULL::${target}, l.row) r
    WHERE l.run_id = $1 AND l.table_name = $2
    ON CONFLICT (${key.map(quoted).join(", ")}) ${change}
    RETURNING 1`;
}

/**
 * Deletes every row of the table the run did not stage, its key's columns joined as text as the staged keys are; for
 * a table that keeps its earlier rows, only among those from its date on ($3). $1 is the run, $2 the table.
 */
export function goneSql({ table, key, keepBefore }: TableMeta): string {
  const joined = key.map((column) => `${quoted(column)}::text`).join(` || '|' || `);
  const since = keepBefore === undefined ? "" : ` AND ${quoted(keepBefore.column)} >= $3::date`;
  return `DELETE FROM ${quoted(SCHEMA)}.${quoted(table)}
    WHERE (${joined}) NOT IN (SELECT key FROM ${STAGED} WHERE run_id = $1 AND table_name = $2)${since}`;
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
    stage: async (run: string, table: TableRows) => {
      await sql.unsafe(`DELETE FROM ${STAGED} WHERE run_id = $1 AND table_name = $2`, [run, table.table]);
      for (let start = 0; start < table.rows.length; start += BATCH) {
        const batch = table.rows.slice(start, start + BATCH);
        const params: Cell[] = batch.flatMap((row) => [rowKey(row, table.key), JSON.stringify(row)]);
        await sql.unsafe(stageSql(batch.length), [run, table.table, ...params] as never[]);
      }
      return metaOf(table);
    },
    swap: async (run, tables) => {
      let written = 0;
      let changed = 0;
      await sql.begin(async (tx) => {
        for (const table of tables) {
          const since = table.keepBefore === undefined ? [] : [table.keepBefore.from];
          if (table.rows > 0) changed += (await tx.unsafe(upsertSql(table), [run, table.table])).length;
          await tx.unsafe(goneSql(table), [run, table.table, ...since] as never[]);
          written += table.rows;
        }
        await tx.unsafe(`DELETE FROM ${STAGED} WHERE run_id = $1`, [run]);
      });
      return { written, changed };
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

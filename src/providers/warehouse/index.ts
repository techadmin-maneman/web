// The nightly reporting copy's store (docs/decisions/0146-the-nightly-analytics-copy.md), behind an interface: the
// analytics schema in Supabase's Postgres, reached through Hyperdrive, or a stub that keeps what it is given. Only the
// nightly job (src/domain/analytics/nightly.ts) writes to it; Zoho Analytics reads it with a role of its own.

import { createStubWarehouse } from "./stub.ts";
import { createSupabaseWarehouse } from "./supabase.ts";

export type Cell = string | number | boolean | null;
export type Row = Readonly<Record<string, Cell>>;

/** A table's rows as tonight's run works them out, every one of them, and the columns that name a row. */
export interface TableRows {
  readonly table: string;
  readonly key: readonly string[];
  readonly rows: readonly Row[];
  /** Whether the table carries updated_at, which Zoho fetches changed rows by. A small shared table is reloaded whole. */
  readonly stamped: boolean;
  /** Rows from this date on are tonight's to replace; those before it stay as an earlier night wrote them. */
  readonly keepBefore?: { readonly column: string; readonly from: string };
}

/** A table as a night staged it: what names its rows, their columns, what it keeps of earlier nights, and how many. */
export interface TableMeta extends Omit<TableRows, "rows"> {
  readonly columns: readonly string[];
  readonly rows: number;
  /** Its amount column's total, to the paisa, for the check against D1; null for a table without one. */
  readonly amountPaise: number | null;
}

export interface WarehouseProvider {
  /** Whether a run finished on this India date already. */
  ranOn(date: string): Promise<boolean>;
  /** Holds a table's rows beside the copy for the run named, in place of any the run staged for it before. */
  stage(run: string, table: TableRows): Promise<TableMeta>;
  /**
   * Makes each table hold what the run staged, all in one transaction, so a reader sees the copy as it was or as
   * tonight's whole: a new or changed row written and stamped now, an unchanged one keeping its stamp, and a row not
   * staged deleted. Then the run's staged rows go. How many were written, and how many of them were new or changed.
   */
  swap(run: string, tables: readonly TableMeta[]): Promise<{ readonly written: number; readonly changed: number }>;
  /** A table's row count, and a column's total, for the check against D1. */
  count(table: string): Promise<number>;
  sum(table: string, column: string): Promise<number>;
  /** The night's run in load_run, which every dashboard shows the time of. */
  logRun(run: RunLog): Promise<void>;
  /** The database's size in bytes, which the free plan limits. */
  size(): Promise<number>;
  close(): Promise<void>;
}

export interface RunLog {
  readonly startedAt: Date;
  readonly endedAt: Date;
  /** India's date the run is for. */
  readonly date: string;
  readonly rowsWritten: number;
  readonly rowsChanged: number;
  readonly totalsChecked: boolean;
  readonly databaseBytes: number;
  readonly notes: string | null;
}

export type AnalyticsProvider = "supabase" | "stub" | "none";

/** The store for this environment; null where the copy is switched off, or its binding is not declared. */
export function warehouseFor(provider: AnalyticsProvider, connectionString: string | null): WarehouseProvider | null {
  if (provider === "stub") return createStubWarehouse();
  if (provider === "supabase" && connectionString !== null) return createSupabaseWarehouse(connectionString);
  return null;
}

/** A table's staged shape, from its rows. */
export function metaOf({ rows, ...table }: TableRows): TableMeta {
  const columns = Object.keys(rows[0] ?? {});
  const amountPaise = columns.includes("amount")
    ? Math.round(rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100)
    : null;
  return { ...table, columns, rows: rows.length, amountPaise };
}

/** A row's key as one string: its key columns as text, joined by "|", as Postgres writes them. */
export const rowKey = (row: Row, key: readonly string[]): string => key.map((column) => String(row[column])).join("|");

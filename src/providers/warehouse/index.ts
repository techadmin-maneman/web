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
}

export interface WarehouseProvider {
  /** Whether a run finished on this India date already. */
  ranOn(date: string): Promise<boolean>;
  /**
   * Makes a table hold these rows: a new or changed row is written and stamped now, an unchanged one keeps its stamp,
   * and a row no longer worked out is deleted. How many were written, and how many of them were new or changed.
   */
  replace(table: TableRows): Promise<{ readonly written: number; readonly changed: number }>;
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

/** Hyperdrive's connection string, once wrangler.jsonc gives this environment the ANALYTICS_DB binding. */
export function hyperdriveOf(env: object): string | null {
  const binding: unknown = Reflect.get(env, "ANALYTICS_DB");
  if (typeof binding !== "object" || binding === null || !("connectionString" in binding)) return null;
  return typeof binding.connectionString === "string" ? binding.connectionString : null;
}

/** The store for this environment; null where the copy is switched off, or its binding is not declared. */
export function warehouseFor(provider: AnalyticsProvider, connectionString: string | null): WarehouseProvider | null {
  if (provider === "stub") return createStubWarehouse();
  if (provider === "supabase" && connectionString !== null) return createSupabaseWarehouse(connectionString);
  return null;
}

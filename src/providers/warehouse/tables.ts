// What both reporting stores work out of a table's rows alike.

import type { Row, TableMeta, TableRows } from "./index.ts";

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

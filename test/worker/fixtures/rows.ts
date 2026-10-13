// How every fixture writes its row: the table's defaults here, then what the test sets, one column for each key
// (insertRow), typed from the schema (src/lib/rows.ts). A column the schema adds is given its default in one place.

import { env } from "cloudflare:workers";
import type { Rows, TableName } from "../../../src/lib/rows.ts";
import { insertRow, type SqlValue } from "../../../src/lib/sql.ts";
import { NOW } from "../clock.ts";

/** What a test may set of a row: any of its columns, and only its columns. */
export type RowOf<T extends TableName> = { -readonly [K in keyof Rows[T]]?: Rows[T][K] & SqlValue };

/** The row written, defaults first, then the test's own. */
export async function writeRow<T extends TableName>(
  table: T,
  defaults: RowOf<T>,
  row: RowOf<T>,
): Promise<Readonly<RowOf<T>>> {
  const written = { ...defaults, ...row };
  await insertRow(env.DB, table, written as Readonly<Record<string, SqlValue>>).run();
  return written;
}

/** The fixtures' clock, as the rows hold it. */
export const AT = NOW.toISOString();

let serial = 0;

/** A number no other fixture of this run has had: for mobiles, codes and serials a unique index holds. */
export const nextSerial = (): number => (serial += 1);

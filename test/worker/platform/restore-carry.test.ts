// A whole-database restore as the runbook runs it: the database is exported, put back to <T>, and the carry-back file
// built from D1's own export is run on it a statement at a time, since D1 loads a long file as several transactions and
// checks foreign keys at the end of each. Every table holds rows at <T> and is written to since, so a migration that
// adds a table or a trigger the carry-back cannot pass fails here.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { carryBack, type ForeignKey, type TableKeys } from "../../../scripts/lib/restore-carry.ts";
import { markDatabase } from "../helpers.ts";
import { ROWS_AT_T, WRITTEN_SINCE_T } from "./restore-fixtures.ts";

/** The switch the runbook sets before the export, and again as soon as the database is back at <T>. */
const MAINTENANCE_ON = `INSERT INTO maintenance (id, reason, started_at)
  VALUES (1, 'restoring D1', '2026-10-02T06:40:00.000Z')`;

const ROW = /^INSERT INTO "(\w+)"/;

async function run(statements: readonly string[]): Promise<void> {
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

/** The database as `wrangler d1 export` writes it, one statement to an entry. */
async function exportDatabase(): Promise<string[]> {
  const result = await env.DB.prepare("PRAGMA miniflare_d1_export(?,?,?);").bind(0, 0).raw();
  return (result as unknown as string[][])[0] ?? [];
}

const asFile = (exported: readonly string[]) => exported.join("\n");

/** Each table's rows, as the export's statements, in order. */
function rowsByTable(exported: readonly string[]): Record<string, string[]> {
  const rows: Record<string, string[]> = {};
  for (const statement of exported) {
    const table = ROW.exec(statement)?.[1];
    if (table === undefined) continue;
    rows[table] = [...(rows[table] ?? []), statement];
  }
  return rows;
}

async function tableNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations'
     ORDER BY rowid`,
  ).all<{ name: string }>();
  return results.map((row) => row.name);
}

/** Each table's keys as D1 reads them; the runbook's script reads the same from the export (scripts/lib/schema-keys.ts). */
async function keysOfDatabase(): Promise<Map<string, TableKeys>> {
  const keys = new Map<string, TableKeys>();
  for (const table of await tableNames()) {
    const primary = await env.DB.prepare("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk")
      .bind(table)
      .all<{ name: string }>();
    const foreignKeys = await env.DB.prepare(`SELECT "table", "from", "to" FROM pragma_foreign_key_list(?)`)
      .bind(table)
      .all<ForeignKey>();
    keys.set(table, { primaryKey: primary.results.map((column) => column.name), foreignKeys: foreignKeys.results });
  }
  return keys;
}

/** Every row as it was at <T>, with the triggers in place, as Time Travel puts the database back. */
async function goBackTo(atT: readonly string[]): Promise<void> {
  const tables = await tableNames();
  const { results: triggers } = await env.DB.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY rowid",
  ).all<{ name: string; sql: string }>();
  const rows = atT.filter((statement) => tables.includes(ROW.exec(statement)?.[1] ?? ""));
  await run([
    "PRAGMA defer_foreign_keys = on",
    ...triggers.map((trigger) => `DROP TRIGGER "${trigger.name}"`),
    ...tables.map((table) => `DELETE FROM "${table}"`),
    ...rows,
    ...triggers.map((trigger) => trigger.sql),
  ]);
}

/** The runbook's steps: the export, back to <T>, the switch on again, and the carry-back. */
async function restoreWholeDatabase(leave: readonly string[] = []) {
  const atT = await exportDatabase();
  await run([...WRITTEN_SINCE_T, MAINTENANCE_ON]);
  const now = await exportDatabase();
  const carry = carryBack(asFile(now), await keysOfDatabase(), leave);
  await goBackTo(atT);
  await run([MAINTENANCE_ON]);
  for (const statement of carry.statements) await env.DB.prepare(statement).run();
  return { atT, now, carry, after: await exportDatabase() };
}

describe("restoring the whole database", () => {
  beforeEach(async () => {
    await markDatabase();
    await run(ROWS_AT_T);
  });

  it("starts from a row in every table, so each table's triggers and constraints meet the carry-back", async () => {
    const atT = rowsByTable(await exportDatabase());
    const empty = (await tableNames()).filter((table) => atT[table] === undefined);
    // The switch is only ever on during a restore.
    expect(empty).toEqual(["maintenance"]);
  });

  it("puts every table back as the export had it, with the switch left on", async () => {
    const { now, after } = await restoreWholeDatabase();

    expect(rowsByTable(after)).toEqual(rowsByTable(now));
    expect(await env.DB.prepare("SELECT reason FROM maintenance").first()).toEqual({ reason: "restoring D1" });
  });

  it("leaves the tables the restore is for as they were at <T>", async () => {
    const { atT, now, after } = await restoreWholeDatabase(["photos"]);

    const { photos: photosAtT, ...carriedAtT } = rowsByTable(atT);
    const { photos: photosNow, ...carriedNow } = rowsByTable(now);
    const { photos: photosAfter, ...carriedAfter } = rowsByTable(after);
    expect(photosNow).not.toEqual(photosAtT);
    expect(photosAfter).toEqual(photosAtT);
    expect(carriedAfter).toEqual(carriedNow);
    expect(carriedAfter).not.toEqual(carriedAtT);
  });

  it("adds to the tables that refuse a delete, and writes last the ones triggers write to", async () => {
    const { carry } = await restoreWholeDatabase();

    expect(carry.addOnly).toEqual([
      "audit_log",
      "consents",
      "credit_ledger",
      "discount_code_uses",
      "hair_profiles",
      "slot_times",
    ]);
    expect(carry.writtenByTriggers).toEqual([
      "people",
      "pieces",
      "consultation_requests",
      "visit_outcomes",
      "first_fit_requests",
      "stock_balances",
      "ops_settings_snapshot",
      "board_version",
      "conversations",
      "stock_places",
      "stock_lot_balances",
    ]);
  });
});

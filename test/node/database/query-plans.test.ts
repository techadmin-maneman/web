// No statement on the five-minute cron's path, or on the requests made while a
// client pays, reads a whole table that keeps growing. The cron runs 288 times
// a day in each environment, and past 5 million rows read a day D1 refuses
// every query until midnight UTC (ADR 0009, migration 0037).
//
// Each statement is read out of the source, where it is passed to .prepare(),
// and planned by SQLite against every migration. It passes when every table it
// scans is one of the few that stay small, or when it walks a partial index,
// which holds only the rows still waiting. The cron's path is every module
// cron.ts imports, followed import by import, so a module joins it without
// being listed. test/worker/jobs/cron-reads.test.ts measures the same thing from the
// other side, over a history that must hold a row in every growing table the
// path names, which is checked here too.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as STATUSES from "../../../src/config/statuses.ts";
import { graceEnds, keepingItsTime, ownUnpaid, paidNotBooked } from "../../../src/domain/hold-stages.ts";
import { creditSpentOn } from "../../../src/domain/visit-facts.ts";

/**
 * Each module the entry imports, and each one those import in turn: every statement the entry could run is in one of
 * them. A type-only import runs nothing, so it is not followed.
 */
function importedBy(entry: string): string[] {
  const seen = new Set<string>();
  const follow = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    for (const statement of source.statements) {
      const imported = runtimeImport(statement);
      if (imported !== null) follow(path.posix.join(path.posix.dirname(file), imported));
    }
  };
  follow(entry);
  return [...seen].sort();
}

/** The local module an import or re-export loads when it runs; null for a package, or for types alone. */
function runtimeImport(statement: ts.Statement): string | null {
  let specifier: ts.Expression | undefined;
  if (ts.isImportDeclaration(statement) && statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
    specifier = statement.moduleSpecifier;
  }
  if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) specifier = statement.moduleSpecifier;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return null;
  return specifier.text.startsWith(".") ? specifier.text : null;
}

/** The meter hands on each statement it is given, so it prepares none of its own. */
const NOT_STATEMENTS = new Set(["src/lib/d1-meter.ts"]);

const CRON_PATH = importedBy("src/scheduled/cron.ts").filter((file) => !NOT_STATEMENTS.has(file));

/** A payment and what it pays for: the hold page polls these while the client pays. */
const PAYMENT_PATH = [
  "src/domain/bookings.ts",
  "src/domain/payments.ts",
  "src/domain/visit-changes.ts",
  "src/domain/hold-slot.ts",
  "src/domain/occupancy.ts",
  "src/domain/visit-times.ts",
  "src/domain/services.ts",
  "src/routes/client/payments.ts",
];

/** Tables that grow with the team or the reference data, not with each client or visit. */
const SMALL_TABLES = new Set([
  "technicians",
  "technician_devices",
  "technician_leave",
  "cities",
  "serviceable_pincodes",
  "ops_settings",
  "ops_settings_snapshot",
  "fsm_items",
  // A row a service, which grows with what ops sell, not with who buys it (docs/decisions/0085-services-ops-can-edit.md).
  "services",
  // What ops set: prices as they change, the day's windows, closed days, the job sheet's lists and the consumables.
  "price_book",
  "slot_times",
  "visit_blackouts",
  "checklist_items",
  "partial_reasons",
  "consumables",
  "consumable_usage",
  // One row for each Zoho product.
  "zoho_access_tokens",
  "sync_cursors",
  "cron_jobs",
  "cron_runs",
  // One row, how far the pass that closes expired credits has got.
  "credit_expiry_cursor",
  // One row, what Phase 2's buckets hold (docs/decisions/0093-the-storage-meter.md).
  "storage_meter",
  // One row, the dispatch board's version.
  "board_version",
]);

/** Statements that do read a whole table, each with why that is all right. */
const ALLOWED = [
  {
    // Once a night, at the end of the reconciliation's pass: the copies FSM did not list.
    file: "src/scheduled/reconcile-fsm.ts",
    sql: "SELECT fsm_id FROM appointments WHERE deleted_at IS NULL AND (reconciled_at IS NULL OR reconciled_at < ?1)",
  },
  {
    // A visit booked without FSM, written only while its hold waits: the guard reads the hold by its key. The scan is
    // SQLite's look for holds pointing at the new visit, which it skips while no foreign key is broken.
    file: "src/domain/bookings.ts",
    sql: "WHERE EXISTS (SELECT 1 FROM slot_holds WHERE id = ?12 AND state = 'held')",
  },
  // The console's own lists, in modules the cron imports for something else; the cron never runs them.
  { file: "src/domain/waitlist.ts", sql: "FROM waitlist_entries w LEFT JOIN serviceable_pincodes p" },
  { file: "src/domain/waitlist.ts", sql: "FROM waitlist_entries w JOIN people p ON p.id = w.person_id GROUP BY" },
  { file: "src/domain/no-shows.ts", sql: "FROM no_show_cases n JOIN checkins c ON c.id = n.checkin_id" },
  { file: "src/domain/discount-codes.ts", sql: "AS uses, (SELECT COALESCE(SUM(u.amount_off), 0)" },
];

/**
 * Statements with a part only known when they run, which SQLite cannot plan from the source, each with why it reads
 * no growing table from end to end.
 */
const UNPLANNED = [
  // An entry written only if the row it is about was: that row, by its key.
  { file: "src/domain/audit.ts", source: "SELECT 1 FROM ${written.table} WHERE id = ?10" },
  { file: "src/domain/audit.ts", source: "SELECT 1 FROM ${ruled.table} WHERE id = ?10 AND ruling_id = ?11" },
  { file: "src/domain/audit.ts", source: "SELECT 1 FROM ${stamped.table} WHERE id = ?10 AND ${stamped.column} = ?1" },
  { file: "src/domain/ruling-claims.ts", source: "SELECT 1 FROM ${ruled.table} WHERE id = ?6 AND ruling_id = ?7" },
  { file: "src/domain/ruling-claims.ts", source: "SELECT 1 FROM ${ruled.table} WHERE id = ?4 AND ruling_id = ?5" },
  // The person's latest consent for the purpose, by consents_by_person.
  { file: "src/domain/consents.ts", source: "${ruleCondition(answer.rule, person)}" },
  // A client's versions, by hair_profiles_by_person; a version written, by its key.
  { file: "src/domain/hair-profiles.ts", source: 'latestIdQuery("?1")' },
  { file: "src/domain/hair-profiles.ts", source: "UPDATE hair_profiles SET ${blanked} WHERE person_id = ?1" },
  { file: "src/domain/hair-profiles.ts", source: "VALUES (${placeholders}) ON CONFLICT (appointment_id, event_id)" },
  { file: "src/domain/hair-profiles.ts", source: 'SELECT ${placeholders} WHERE (${latestIdQuery("?2")})' },
  // A record's city, for the console: the record by its key, its city by indexed lookups. The cron never runs it.
  { file: "src/domain/places.ts", source: "FROM ${table} record WHERE record.id = ?1" },
  // The cities of the tasks a look at the board found: each record by its key. The cron never runs it.
  { file: "src/domain/places.ts", source: "FROM ${RECORD_PLACES[kind].table} record WHERE record.id IN" },
];

/** Where test/worker/jobs/cron-reads.test.ts keeps the history a cron run is measured against. */
const CRON_HISTORY = { file: "test/worker/jobs/cron-reads.test.ts", name: "HISTORY" };

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations")
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  return db;
}

interface Statement {
  readonly where: string;
  readonly sql: string | null;
  /** What is passed to .prepare(), as written, its spaces collapsed. */
  readonly source: string;
}

const collapsed = (text: string): string => text.replace(/\s+/g, " ");

/** The SQL fragments the queries share, written out as each call site's arguments ask. */
const FRAGMENTS: Readonly<Record<string, (...names: never[]) => string>> = {
  creditSpentOn,
  graceEnds,
  keepingItsTime,
  ownUnpaid,
  paidNotBooked,
  statusIn: STATUSES.statusIn,
  statusNotIn: STATUSES.statusNotIn,
};

/** A status set a fragment is handed, by its name in src/config/statuses.ts. */
const STATUS_SETS = new Map<string, unknown>(Object.entries(STATUSES));

/** The SQL of every .prepare() in a file, with `${…}` filled from the file's own constants where it can be. */
function statementsIn(file: string): Statement[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const constants = new Map<string, ts.Expression>();
  const prepared: { where: string; argument: ts.Node | undefined }[] = [];

  const textOf = (node: ts.Node | undefined): string | null => {
    if (node === undefined) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return textOf(constants.get(node.text));
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fragment = FRAGMENTS[node.expression.text];
      // A name passed at run time, as `now`, plans the same as a parameter.
      const argumentOf = (argument: ts.Expression) =>
        (ts.isIdentifier(argument) ? STATUS_SETS.get(argument.text) : undefined) ?? textOf(argument) ?? "?";
      if (fragment !== undefined) return fragment(...(node.arguments.map(argumentOf) as never[]));
    }
    if (!ts.isTemplateExpression(node)) return null;
    // A list of placeholders built at run time plans the same as a single NULL.
    return node.templateSpans.reduce(
      (text, span) => text + (textOf(span.expression) ?? "NULL") + span.literal.text,
      node.head.text,
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      constants.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "prepare"
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      prepared.push({ where: `${file}:${String(line)}`, argument: node.arguments[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // Read once the whole file is walked, so a statement may use a constant declared below it.
  return prepared.map(({ where, argument }) => ({
    where,
    sql: textOf(argument),
    source: collapsed(argument?.getText() ?? ""),
  }));
}

/** Each table a statement names: by its alias where it has one, else by its own name. */
function tablesOf(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const keywords =
    /^(ON|WHERE|JOIN|LEFT|INNER|CROSS|NATURAL|OUTER|ORDER|GROUP|HAVING|WINDOW|LIMIT|SET|USING|AND|OR|NOT|VALUES|SELECT|DEFAULT|UNION|EXCEPT|INTERSECT|RETURNING|INDEXED|DO)$/i;
  for (const match of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const [, table = "", alias] = match;
    const named = alias !== undefined && !keywords.test(alias) ? alias : table;
    tables.set(named, table);
  }
  return tables;
}

function isPartial(db: DatabaseSync, index: string): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index) as
    { sql: string | null } | undefined;
  return /\bWHERE\b/i.test(row?.sql ?? "");
}

/** The tables a statement inserts into or updates. */
function writtenBy(sql: string): Set<string> {
  return new Set([...sql.matchAll(/\b(?:INTO|UPDATE)\s+(\w+)/gi)].map(([, table = ""]) => table));
}

/**
 * Whether a table the statement never reads by that name has rows pointing at one it writes. An upsert into a table
 * with triggers, as appointments has since migration 0053, plans a look through each such table for rows pointing at
 * a key it changes; SQLite takes that look only when the key did change, and no upsert here changes its row's key
 * (test/worker/jobs/cron-reads.test.ts counts what is read). A table the statement reads under an alias shows in the plan
 * by the alias, so its own name there is the look.
 */
function pointsAtWritten(db: DatabaseSync, sql: string, table: string): boolean {
  if (tablesOf(sql).has(table)) return false;
  const written = writtenBy(sql);
  const keys = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as { table: string }[];
  return keys.some((key) => written.has(key.table));
}

/** What in a statement's plan reads a growing table from end to end; empty when nothing does. */
function fullReads(db: DatabaseSync, sql: string): string[] {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
  const tables = tablesOf(sql);
  return plan
    .map((step) => step.detail)
    .filter((detail) => {
      const scan = /^SCAN (\S+)(?: USING (?:COVERING )?INDEX (\S+))?/.exec(detail);
      if (scan === null) return false;
      const [, name = "", index] = scan;
      // A constant, a JSON value taken apart, or a result SQLite made itself from a subquery.
      if (name === "CONSTANT" || name === "json_each" || name.startsWith("(")) return false;
      if (SMALL_TABLES.has(tables.get(name) ?? name)) return false;
      if (pointsAtWritten(db, sql, name)) return false;
      return index === undefined || !isPartial(db, index);
    });
}

/** Each full read in a statement's plan, as a line saying where; or why SQLite could not plan it. */
function readsOf(db: DatabaseSync, statement: Statement): string[] {
  try {
    return fullReads(db, statement.sql ?? "").map((detail) => `${statement.where}: ${detail}`);
  } catch (error) {
    return [`${statement.where}: SQLite cannot plan it (${error instanceof Error ? error.message : String(error)})`];
  }
}

const allowed = (statement: Statement) =>
  ALLOWED.some(
    (entry) => statement.where.startsWith(`${entry.file}:`) && collapsed(statement.sql ?? "").includes(entry.sql),
  );

const unplanned = (statement: Statement) =>
  UNPLANNED.some((entry) => statement.where.startsWith(`${entry.file}:`) && statement.source.includes(entry.source));

/** The tables the cron-reads history puts a row in. */
function seededByCronHistory(): Set<string> {
  const { file, name } = CRON_HISTORY;
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((each) => ts.isIdentifier(each.name) && each.name.text === name);
  return writtenBy(declaration?.initializer?.getText() ?? "");
}

describe.each([
  ["the cron's path", CRON_PATH],
  ["a payment's path", PAYMENT_PATH],
])("%s", (_name, files) => {
  const db = migrated();
  const statements = files.flatMap(statementsIn).filter((statement) => !unplanned(statement));

  it("has every statement written out where it is prepared", () => {
    expect(statements.length).toBeGreaterThan(50);
    expect(statements.filter((statement) => statement.sql === null).map((statement) => statement.where)).toEqual([]);
  });

  it("reads no growing table from end to end", () => {
    const reads = statements
      .filter((statement) => statement.sql !== null && !allowed(statement))
      .flatMap((statement) => readsOf(db, statement));
    expect(reads).toEqual([]);
  });
});

describe("the cron's path, followed from cron.ts", () => {
  it("reaches the modules its jobs call, and the ones those call", () => {
    expect(CRON_PATH).toEqual(
      expect.arrayContaining([
        "src/scheduled/sweeper.ts",
        "src/domain/ops-settings.ts",
        "src/config/message-kinds.ts",
        "src/domain/slot-times.ts",
        "src/domain/price-book.ts",
        "src/domain/audit.ts",
      ]),
    );
  });

  it("has a row in every growing table it names in the history test/worker/jobs/cron-reads.test.ts measures a run against", () => {
    const db = migrated();
    const real = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    const named = new Set(
      CRON_PATH.flatMap(statementsIn).flatMap((statement) => [...tablesOf(statement.sql ?? "").values()]),
    );
    const seeded = seededByCronHistory();
    expect(seeded.size).toBeGreaterThan(10);

    const unseeded = [...named].filter((table) => real.has(table) && !SMALL_TABLES.has(table) && !seeded.has(table));
    expect(unseeded.sort()).toEqual([]);
  });
});

describe("the check itself", () => {
  const db = migrated();

  it("catches a whole table read, and one walked along an index that holds every row", () => {
    expect(fullReads(db, "SELECT id FROM tryon_jobs WHERE result_key IS NOT NULL")).toEqual(["SCAN tryon_jobs"]);
    expect(fullReads(db, "SELECT upload_key FROM tryon_jobs GROUP BY upload_key")).toEqual([
      "SCAN tryon_jobs USING COVERING INDEX tryon_jobs_by_upload",
    ]);
  });

  it("lets through the look an upsert plans for rows pointing at a key it does not change", () => {
    const upsert = `INSERT INTO appointments (id, fsm_id, status, fsm_status, fsm_modified_at, synced_at)
      VALUES (?1, ?2, 'scheduled', 'Scheduled', ?3, ?3) ON CONFLICT (fsm_id) DO UPDATE SET status = excluded.status`;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${upsert}`).all() as { detail: string }[]).map((step) => step.detail);
    expect(plan).toContain("SCAN stock_movements");
    expect(fullReads(db, upsert)).toEqual([]);
    // One that does read the table names it, and is caught.
    expect(fullReads(db, `${upsert} RETURNING (SELECT MAX(note) FROM stock_movements)`)).toContain(
      "SCAN stock_movements",
    );
  });

  it("tells that look from the upsert's own read of the same table under an alias", () => {
    const upsert = `INSERT INTO appointments (id, fsm_id, status, fsm_status, fsm_modified_at, synced_at, tier)
      VALUES (?1, ?2, 'scheduled', 'Scheduled', ?3, ?3,
        (SELECT h.tier FROM slot_holds h WHERE h.appointment_id = ?1 AND h.state = 'booked' LIMIT 1))
      ON CONFLICT (fsm_id) DO UPDATE SET status = excluded.status`;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${upsert}`).all() as { detail: string }[]).map((step) => step.detail);
    expect(plan).toContain("SCAN slot_holds");
    expect(fullReads(db, upsert)).toEqual([]);
    expect(fullReads(db, upsert.replace("h.appointment_id = ?1", "h.tier IS NOT NULL"))).toEqual(["SCAN h"]);
  });

  it("lets through a result SQLite makes itself from a subquery", () => {
    const union = `SELECT asked FROM (SELECT requested_window AS asked FROM consultation_requests WHERE person_id = ?1
      UNION ALL SELECT window_label FROM slot_holds WHERE person_id = ?1) LIMIT 1`;
    expect(fullReads(db, union)).toEqual([]);
  });

  it("lets a partial index through, since it holds only the rows still waiting", () => {
    expect(
      fullReads(
        db,
        "SELECT upload_key FROM tryon_jobs WHERE upload_deleted_at IS NULL AND uploaded_at IS NOT NULL GROUP BY upload_key",
      ),
    ).toEqual([]);
  });

  it("says where a statement is that SQLite cannot plan, rather than stopping", () => {
    const statement = { where: "src/domain/example.ts:12", sql: "SELECT 1 FROM NULL", source: "" };
    expect(readsOf(db, statement)).toEqual([expect.stringMatching(/^src\/domain\/example\.ts:12: SQLite cannot plan/)]);
  });
});

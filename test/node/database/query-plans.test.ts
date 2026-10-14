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
import { graceEnds, keepingItsTime, ownUnpaid, paidNotBooked } from "../../../src/domain/booking/hold-stages.ts";
import { creditSpentOn } from "../../../src/domain/visits/visit-facts.ts";
import { visitCity } from "../../../src/domain/clients/places.ts";
import { tierOf } from "../../../src/config/visit-types.ts";
import { indiaDateSql } from "../../../src/lib/india-time.ts";

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
  "src/domain/booking/bookings.ts",
  "src/domain/money/payments.ts",
  "src/domain/visits/visit-changes.ts",
  "src/domain/booking/hold-slot.ts",
  "src/domain/booking/occupancy.ts",
  "src/domain/visits/visit-times.ts",
  "src/domain/booking/services.ts",
  "src/routes/client/payments.ts",
];

/** Tables that grow with the team or the reference data, not with each client or visit. */
const SMALL_TABLES = new Set([
  "technicians",
  "technician_devices",
  "technician_leave",
  "cities",
  "zones",
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
  "lost_reasons",
  // A row a product a time Finance set its cost.
  "standard_costs",
  // A row a city, month and measure.
  "targets",
  "consumables",
  "consumable_usage",
  // A row a hair system stock code ops range, or a custom order's spec: the catalogue, as consumables is.
  "hair_systems",
  // A row a planning period, let go after the learning days: a few dozen at most.
  "forecast_runs",
  // A row a place stock is kept: the warehouse, each hub and stockroom, and a kit a technician.
  "stock_places",
  // What Growth sets on the Words page, a row an edit: it grows with ops' work, not with clients.
  "word_versions",
  // One row for each Zoho product.
  "zoho_access_tokens",
  "sync_cursors",
  "cron_jobs",
  "cron_runs",
  // One row, how far the pass that closes expired credits has got.
  "credit_expiry_cursor",
  // One row, what the apps' buckets hold (docs/decisions/0093-the-storage-meter.md).
  "storage_meter",
  // One row, the dispatch board's version.
  "board_version",
  // The Staff list and its grants, and the names the Care team go by: a row a member of staff, not a client.
  "staff",
  "staff_grants",
  "care_names",
  // What a city sets apart (docs/decisions/0198-cities-as-data.md): a row a city and rule, a city's price as it
  // changes, and a GST registration a state.
  "city_settings",
  "city_prices",
  "gst_registrations",
]);

/** Statements that do read a whole table, each with why that is all right. */
const ALLOWED = [
  {
    // A custom order's purchase order, drafted once: the guard reads the custom order by its key. The scan is SQLite's
    // look for custom orders pointing at the new purchase order, which it skips while no foreign key is broken.
    file: "src/domain/purchasing/custom-order-po.ts",
    sql: "WHERE NOT EXISTS (SELECT 1 FROM custom_orders WHERE id = ?8 AND po_id IS NOT NULL)",
  },
  {
    // A visit booked without FSM, written only while its hold waits: the guard reads the hold by its key. The scan is
    // SQLite's look for holds pointing at the new visit, which it skips while no foreign key is broken.
    file: "src/domain/booking/bookings.ts",
    sql: "WHERE EXISTS (SELECT 1 FROM slot_holds WHERE id = ?12 AND state = 'held')",
  },
  // The console's own lists, in modules the cron imports for something else; the cron never runs them.
  // The Stock page's demand, every code's stock by city; the hourly risks read only the codes they need.
  { file: "src/domain/purchasing/stock-demand.ts", sql: "WHERE b.quantity > 0 GROUP BY 1, 2" },
  { file: "src/domain/booking/waitlist.ts", sql: "FROM waitlist_entries w LEFT JOIN serviceable_pincodes p" },
  {
    file: "src/domain/booking/waitlist.ts",
    sql: "FROM waitlist_entries w JOIN people p ON p.id = w.person_id GROUP BY",
  },
  { file: "src/domain/no-shows/no-shows.ts", sql: "FROM no_show_cases n JOIN checkins c ON c.id = n.checkin_id" },
  { file: "src/domain/money/discount-codes.ts", sql: "AS uses, (SELECT COALESCE(SUM(u.amount_off), 0)" },
  { file: "src/domain/care/remedies.ts", sql: "FROM remedies r JOIN people p ON p.id = r.person_id" },
  // The weekly backup's list of tables, indexes and triggers, and each table's keys: SQLite's own catalogue, a row a
  // table, index or trigger.
  { file: "src/domain/platform/backups.ts", sql: "FROM sqlite_master m LEFT JOIN pragma_foreign_key_list(m.name) f" },
  // The reporting copy reads every client, visit and payment, once a night in the hour from 3 am in India
  // (docs/decisions/0146-the-nightly-analytics-copy.md).
  { file: "src/domain/analytics/nightly.ts", sql: "SELECT id FROM people WHERE test_record = 0 AND erased_at IS NULL" },
  { file: "src/domain/analytics/rows.ts", sql: "FROM people p WHERE p.test_record = 0 AND p.erased_at IS NULL" },
  { file: "src/domain/analytics/rows.ts", sql: "FROM appointments a JOIN people p ON p.id = a.person_id" },
  { file: "src/domain/analytics/rows.ts", sql: "FROM payments y JOIN people p ON p.id = y.person_id" },
  { file: "src/domain/analytics/care-cases.ts", sql: "FROM grievances g JOIN people p ON p.id = g.person_id" },
  { file: "src/domain/analytics/care-cases.ts", sql: "FROM task_spans s" },
  { file: "src/domain/analytics/leads.ts", sql: "FROM leads l LEFT JOIN addresses d ON d.person_id = l.person_id" },
  { file: "src/domain/analytics/pieces.ts", sql: "FROM pieces c JOIN people p ON p.id = c.person_id" },
  { file: "src/domain/analytics/client-months.ts", sql: "FROM appointments a JOIN people p ON p.id = a.person_id" },
  { file: "src/domain/analytics/credits.ts", sql: "FROM credit_ledger c JOIN people p ON p.id = c.person_id" },
  {
    file: "src/domain/analytics/stock.ts",
    sql: "FROM stock_movements m LEFT JOIN technicians t ON t.id = m.technician_id",
  },
  { file: "src/domain/analytics/stock.ts", sql: "FROM appointments a JOIN technicians t ON t.id = a.technician_id" },
  { file: "src/domain/analytics/spend.ts", sql: "FROM partner_payouts WHERE amount > 0" },
  { file: "src/domain/analytics/spend.ts", sql: "FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id" },
  // The new tasks a night's look at the board found, handed over as a JSON list (docs/decisions/0147-task-spans.md).
  { file: "src/domain/ops/task-spans.ts", sql: "FROM json_each(?1) t WHERE NOT EXISTS" },
];

/**
 * Statements with a part only known when they run, which SQLite cannot plan from the source, each with why it reads
 * no growing table from end to end.
 */
const UNPLANNED = [
  // The weekly backup reads every table whole, a page at a time, once a week in the hour from 3 am in India.
  { file: "src/domain/platform/backups.ts", source: "SELECT * FROM ${quoted(table.name)}" },
  { file: "src/domain/platform/backups.ts", source: "SELECT rowid AS backup_rowid, * FROM ${quoted(table.name)}" },
  // An entry written only if the row it is about was: that row, by its key.
  { file: "src/domain/platform/audit.ts", source: "SELECT 1 FROM ${written.table} WHERE id = ?10" },
  { file: "src/domain/platform/audit.ts", source: "SELECT 1 FROM ${deleted.table} WHERE ${deleted.column} = ?10" },
  { file: "src/domain/platform/audit.ts", source: "SELECT 1 FROM ${ruled.table} WHERE id = ?10 AND ruling_id = ?11" },
  {
    file: "src/domain/platform/audit.ts",
    source: "SELECT 1 FROM ${stamped.table} WHERE id = ?10 AND ${stamped.column} = ?1",
  },
  {
    file: "src/domain/no-shows/ruling-claims.ts",
    source: "SELECT 1 FROM ${ruled.table} WHERE id = ?6 AND ruling_id = ?7",
  },
  {
    file: "src/domain/no-shows/ruling-claims.ts",
    source: "SELECT 1 FROM ${ruled.table} WHERE id = ?4 AND ruling_id = ?5",
  },
  // The person's latest consent for the purpose, by consents_by_person.
  { file: "src/domain/privacy/consents.ts", source: "${ruleCondition(answer.rule, person)}" },
  // A client's versions, by hair_profiles_by_person; a version written, by its key.
  { file: "src/domain/clients/hair-profiles.ts", source: 'latestIdQuery("?1")' },
  { file: "src/domain/clients/hair-profiles.ts", source: "UPDATE hair_profiles SET ${blanked} WHERE person_id = ?1" },
  {
    file: "src/domain/clients/hair-profiles.ts",
    source: "VALUES (${placeholders}) ON CONFLICT (appointment_id, event_id)",
  },
  { file: "src/domain/clients/hair-profiles.ts", source: 'SELECT ${placeholders} WHERE (${latestIdQuery("?2")})' },
  // A record's city, for the console: the record by its key, its city by indexed lookups. The cron never runs it.
  { file: "src/domain/clients/places.ts", source: "FROM ${table} record WHERE record.id = ?1" },
  // The cities of the tasks a look at the board found: each record by its key. The cron never runs it.
  { file: "src/domain/clients/places.ts", source: "FROM ${RECORD_PLACES[kind].table} record WHERE record.id IN" },
  // The Tasks board, read once a night by the task spans job, as the console reads it at each look
  // (docs/decisions/0147-task-spans.md).
  { file: "src/domain/ops/tasks.ts", source: "withOwners(queue.sql)" },
  // One reason list's row, by its code (docs/decisions/0149-lost-reasons.md).
  { file: "src/domain/field/job-sheet-settings.ts", source: "INSERT INTO ${REASON_LISTS[which.list].table}" },
  // One row inserted from an object's columns, its conflict clause at most reading the row's own key.
  { file: "src/lib/sql.ts", source: 'tail === "" ? sql : `${sql} ${tail}`' },
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
  bookedAhead: STATUSES.bookedAhead,
  creditSpentOn,
  graceEnds,
  indiaDateSql,
  keepingItsTime,
  ownUnpaid,
  paidNotBooked,
  statusIn: STATUSES.statusIn,
  statusNotIn: STATUSES.statusNotIn,
  tierOf,
  visitCity,
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
 * Whether a table the statement never reads by that name has rows pointing at one it writes. An insert whose rows
 * come from a SELECT plans a look through each table pointing at the one it writes, for rows pointing at the key it
 * writes; SQLite plans it and does not take it (test/worker/jobs/cron-reads.test.ts counts what is read). A table the
 * statement reads under an alias shows in the plan by the alias, so its own name there is the look.
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
        "src/domain/platform/ops-settings.ts",
        "src/config/message-kinds.ts",
        "src/domain/booking/slot-times.ts",
        "src/domain/money/price-book.ts",
        "src/domain/platform/audit.ts",
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

  // A move's proposals point at it by move_id, which no index leads with, so writing a move plans a scan of them.
  it("lets through the look a write plans for rows pointing at the key it writes", () => {
    const write = `INSERT INTO dispatch_moves (id, appointment_id, reason, actor, fsm_write_state, created_at, updated_at)
      SELECT ?1, ?2, 'client_asked', 'ops', 'none', ?3, ?3
      WHERE NOT EXISTS (SELECT 1 FROM dispatch_moves WHERE appointment_id = ?2)`;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${write}`).all() as { detail: string }[]).map((step) => step.detail);
    expect(plan).toContain("SCAN move_proposals");
    expect(fullReads(db, write)).toEqual([]);
    // One that does read the table names it, and is caught.
    expect(fullReads(db, `${write} RETURNING (SELECT MAX(reason) FROM move_proposals)`)).toContain(
      "SCAN move_proposals",
    );
  });

  it("tells that look from the write's own read of the same table under an alias", () => {
    const write = `INSERT INTO dispatch_moves (id, appointment_id, reason, actor, fsm_write_state, created_at, updated_at)
      SELECT ?1, ?2, 'client_asked', 'ops', 'none', ?3, ?3
      WHERE EXISTS (SELECT 1 FROM move_proposals p WHERE p.id = ?4)`;
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${write}`).all() as { detail: string }[]).map((step) => step.detail);
    expect(plan).toContain("SCAN move_proposals");
    expect(fullReads(db, write)).toEqual([]);
    expect(fullReads(db, write.replace("p.id = ?4", "p.reason IS NOT NULL"))).toEqual(["SCAN p EXISTS"]);
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

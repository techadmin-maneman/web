// No statement on the five-minute cron's path, or on the requests made while a
// client pays, reads a whole table that keeps growing. The cron runs 288 times
// a day in each environment, and past 5 million rows read a day D1 refuses
// every query until midnight UTC (ADR 0009, migration 0037).
//
// Each statement is read out of the source, where it is passed to .prepare(),
// and planned by SQLite against every migration. It passes when every table it
// scans is one of the few that stay small, or when it walks a partial index,
// which holds only the rows still waiting. test/worker/cron-reads.test.ts
// measures the same thing from the other side.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CRON_PATH = [
  "src/scheduled/cron.ts",
  "src/domain/alerts.ts",
  "src/scheduled/sweeper.ts",
  "src/scheduled/reconcile-fsm.ts",
  "src/domain/erasure.ts",
  "src/domain/deletion.ts",
  "src/domain/tryon.ts",
  "src/domain/kept-try-ons.ts",
  "src/domain/fsm-invoices.ts",
  "src/domain/asked-windows.ts",
  "src/domain/books-sync.ts",
  "src/domain/referral-grants.ts",
  "src/domain/credits.ts",
  "src/domain/visit-messages.ts",
  "src/domain/dispatch.ts",
];

/** A payment and what it pays for: the hold page polls these while the client pays. */
const PAYMENT_PATH = [
  "src/domain/bookings.ts",
  "src/domain/payments.ts",
  "src/domain/visit-changes.ts",
  "src/domain/scheduling.ts",
  "src/routes/client-payments.ts",
];

/** Tables that grow with the team or the reference data, not with each client or visit. */
const SMALL_TABLES = new Set([
  "technicians",
  "technician_devices",
  "technician_leave",
  "cities",
  "serviceable_pincodes",
  "ops_settings",
  "fsm_items",
  "sync_cursors",
  "cron_jobs",
]);

/** Statements that do read a whole table, each with why that is all right. */
const ALLOWED = [
  {
    // Once a night, at the end of the reconciliation's pass: the copies FSM did not list.
    file: "src/scheduled/reconcile-fsm.ts",
    sql: "SELECT fsm_id FROM appointments WHERE deleted_at IS NULL AND (reconciled_at IS NULL OR reconciled_at < ?1)",
  },
];

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
}

/** The SQL of every .prepare() in a file, with `${…}` filled from the file's own constants where it can be. */
function statementsIn(file: string): Statement[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const constants = new Map<string, ts.Expression>();
  const prepared: { where: string; argument: ts.Node | undefined }[] = [];

  const textOf = (node: ts.Node | undefined): string | null => {
    if (node === undefined) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return textOf(constants.get(node.text));
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
  return prepared.map(({ where, argument }) => ({ where, sql: textOf(argument) }));
}

/** Each table a statement names, by its alias as well as by its own name. */
function tablesOf(sql: string): Map<string, string> {
  const tables = new Map<string, string>();
  const keywords = /^(ON|WHERE|JOIN|LEFT|INNER|CROSS|ORDER|GROUP|LIMIT|SET|USING|AND|VALUES)$/i;
  for (const match of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const [, table = "", alias] = match;
    tables.set(table, table);
    if (alias !== undefined && !keywords.test(alias)) tables.set(alias, table);
  }
  return tables;
}

function isPartial(db: DatabaseSync, index: string): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index) as
    { sql: string | null } | undefined;
  return /\bWHERE\b/i.test(row?.sql ?? "");
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
      if (name === "CONSTANT" || name === "json_each") return false;
      if (SMALL_TABLES.has(tables.get(name) ?? name)) return false;
      return index === undefined || !isPartial(db, index);
    });
}

const allowed = (statement: Statement) =>
  ALLOWED.some(
    (entry) =>
      statement.where.startsWith(`${entry.file}:`) && (statement.sql ?? "").replace(/\s+/g, " ").includes(entry.sql),
  );

describe.each([
  ["the cron's path", CRON_PATH],
  ["a payment's path", PAYMENT_PATH],
])("%s", (_name, files) => {
  const db = migrated();
  const statements = files.flatMap(statementsIn);

  it("has every statement written out where it is prepared", () => {
    expect(statements.length).toBeGreaterThan(50);
    expect(statements.filter((statement) => statement.sql === null).map((statement) => statement.where)).toEqual([]);
  });

  it("reads no growing table from end to end", () => {
    const reads = statements
      .filter((statement) => statement.sql !== null && !allowed(statement))
      .flatMap((statement) => fullReads(db, statement.sql ?? "").map((detail) => `${statement.where}: ${detail}`));
    expect(reads).toEqual([]);
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

  it("lets a partial index through, since it holds only the rows still waiting", () => {
    expect(
      fullReads(
        db,
        "SELECT upload_key FROM tryon_jobs WHERE upload_deleted_at IS NULL AND uploaded_at IS NOT NULL GROUP BY upload_key",
      ),
    ).toEqual([]);
  });
});

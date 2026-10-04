// The calls the domain code makes of D1 (prepare, bind, all, first, run and batch), answered by node's SQLite over
// the migrated schema, for a test that runs a domain function in Node and watches what its statements touch.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** An empty database with every migration applied, as D1 holds it. */
export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const migrations = readdirSync("migrations").filter((name) => name.endsWith(".sql"));
  for (const file of migrations.sort()) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  return db;
}

class Statement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly values: readonly SQLInputValue[];
  private readonly seen: (sql: string) => void;

  constructor(db: DatabaseSync, sql: string, values: readonly SQLInputValue[], seen: (sql: string) => void) {
    this.db = db;
    this.sql = sql;
    this.values = values;
    this.seen = seen;
  }

  bind(...values: SQLInputValue[]): Statement {
    return new Statement(this.db, this.sql, values, this.seen);
  }

  all(): Promise<{ results: Record<string, unknown>[]; success: true; meta: { changes: number } }> {
    return Promise.resolve(this.answer());
  }

  async first(column?: string): Promise<unknown> {
    const row = (await this.all()).results[0];
    if (row === undefined) return null;
    return column === undefined ? row : row[column];
  }

  run(): Promise<{ results: Record<string, unknown>[]; success: true; meta: { changes: number } }> {
    return Promise.resolve(this.answer());
  }

  /** Runs the statement: its rows where it returns any, and how many rows it changed. */
  answer(): { results: Record<string, unknown>[]; success: true; meta: { changes: number } } {
    this.seen(this.sql);
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length > 0) {
      const results = statement.all(...this.values) as Record<string, unknown>[];
      return { results, success: true, meta: { changes: 0 } };
    }
    const outcome = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(outcome.changes) } };
  }
}

/**
 * The database as the domain code takes it. `seen` hears each statement's SQL as it runs, in order. A batch runs as
 * one transaction, as D1's does.
 */
export function asD1(db: DatabaseSync, seen: (sql: string) => void = () => undefined): D1Database {
  const database = {
    prepare: (sql: string) => new Statement(db, sql, [], seen),
    batch: (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const answers = statements.map((statement) => statement.answer());
        db.exec("COMMIT");
        return Promise.resolve(answers);
      } catch (error) {
        db.exec("ROLLBACK");
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
  };
  return database as unknown as D1Database;
}

// What a script needs to run a real Zoho adapter (src/providers/zoho-http.ts) outside the Worker: a database for its
// access token, and a logger that keeps each call's step and status for the record.

import { DatabaseSync } from "node:sqlite";
import type { Logger, LogFields } from "../../src/log.ts";

/** The one table the requester keeps, in memory: the access token, minted once for the run. */
export function tokenTable(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    `CREATE TABLE zoho_access_tokens (client TEXT PRIMARY KEY, access_token TEXT, expires_at TEXT,
       refreshing_until TEXT, cool_down_until TEXT)`,
  );
  const prepare = (sql: string) => ({
    bind: (...values: (string | null)[]) => ({
      first: () => Promise.resolve(sqlite.prepare(sql).get(...values) ?? null),
      run: () => Promise.resolve(sqlite.prepare(sql).run(...values)),
    }),
  });
  return { prepare } as unknown as D1Database;
}

/** A logger that adds "<step> <status>" to `callsMade` for each Zoho call, and keeps nothing else it is told. */
export function callLogger(callsMade: string[]): Logger {
  const note = (event: string, fields?: LogFields) => {
    if (event === "vendor_call") callsMade.push(`${String(fields?.step)} ${String(fields?.status)}`);
  };
  const logger: Logger = { debug: note, info: note, warn: note, error: note, child: () => logger };
  return logger;
}

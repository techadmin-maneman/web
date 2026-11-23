// The database with something done between the re-plan's read and its write (src/domain/booking/replan-day.ts), as a
// hold, or ops, can change the day between the two.

import { env } from "cloudflare:workers";

/** The database, with `raced` done just before the re-plan writes its moves, after it read the day. */
export function racedBy(raced: () => Promise<unknown>): D1Database {
  let writing = false;
  let done = false;
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") {
        return (sql: string) => {
          if (sql.includes("INSERT INTO dispatch_moves")) writing = true;
          return target.prepare(sql);
        };
      }
      if (key === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (writing && !done) {
            done = true;
            await raced();
          }
          return target.batch(statements);
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

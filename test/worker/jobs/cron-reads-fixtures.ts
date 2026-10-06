// What the read-cost tests share (cron-reads*.test.ts): a day, times ago and to come, a figure over its ceiling, and
// the rows a read touched.

import { env } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { NOW, captureLogs, countRowsRead } from "../helpers.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Two months ago, when all of the history happened, and an hour later. */
export const AGO = new Date(NOW.getTime() - 60 * DAY_MS).toISOString();

export const IN_TWO_MONTHS = new Date(NOW.getTime() + 60 * DAY_MS).toISOString();

/** The statement over the numbers ?1 to ?2, with anything more it takes from ?3 on. */
export const over = (sql: string, from: number, to: number, ...more: (string | number)[]) =>
  env.DB.prepare(`WITH RECURSIVE n(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2) ${sql}`).bind(
    from,
    to,
    ...more,
  );

/** Rows read by one call the console makes. */
export async function rowsReadBy(call: () => Promise<Response>): Promise<number> {
  const rowsRead = countRowsRead();
  const answer = await call();
  const read = rowsRead();
  vi.restoreAllMocks();
  captureLogs();
  expect(answer.status).toBe(200);
  return read;
}

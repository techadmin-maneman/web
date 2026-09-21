// Global daily ceilings. The render ceiling caps AILabTools spend; the upload,
// render and result-read ceilings together cap R2 use inside the free tier
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md). A breach answers
// 503 busy and alerts, at most once a day per ceiling.

import type { Alert } from "../providers/alerts.ts";
import { indiaDate } from "../lib/india-time.ts";
import { takeOne } from "./rate-limit.ts";

export type Ceiling = "upload" | "render" | "result_read";

/** Counts one use against today's ceiling; false once the ceiling is reached. */
export function takeFromCeiling(db: D1Database, ceiling: Ceiling, limit: number, now: Date): Promise<boolean> {
  return takeOne(db, { scope: `ceiling:${ceiling}`, key: "all", window: indiaDate(now), limit });
}

export async function alertCeilingReached(
  db: D1Database,
  alert: Alert,
  ceiling: Ceiling,
  limit: number,
  now: Date,
): Promise<void> {
  const first = await takeOne(db, { scope: "alert:ceiling", key: ceiling, window: indiaDate(now), limit: 1 });
  if (first)
    await alert(
      `The daily ${ceiling} ceiling (${String(limit)}) is reached; try-ons answer "busy" until midnight IST.`,
    );
}

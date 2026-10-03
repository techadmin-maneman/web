// Global daily ceilings. The render ceiling caps AILabTools spend; the upload,
// render and result-read ceilings together cap R2 use inside the free tier
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md); the geocode
// ceiling caps what the address search can spend on the owner's Google card
// (docs/decisions/0054-address-capture.md). A breach answers 503 busy and
// alerts, at most once a day per ceiling.

import type { Alert } from "../providers/alerts.ts";
import { indiaDate } from "../lib/india-time.ts";
import { isSpent, takeOne } from "./rate-limit.ts";

export type Ceiling = "upload" | "render" | "result_read" | "login_code" | "tech_code" | "form_code" | "geocode";

/** What stops while a ceiling is reached, for its alert. */
const STOPPED: Readonly<Record<Ceiling, string>> = {
  upload: "try-ons",
  render: "try-ons",
  result_read: "try-ons",
  login_code: "the client app's login codes and number changes",
  // Only an active technician's number is sent a code, so clients and strangers cannot spend this one.
  tech_code: "the technician app's login codes",
  // The site's codes go to whatever number is typed, so they have a ceiling of their own and never stop a login.
  form_code: "the site's WhatsApp codes for the one visit and the try-on",
  geocode: "address suggestions",
};

/** Counts one use against today's ceiling; false once the ceiling is reached. */
export function takeFromCeiling(db: D1Database, ceiling: Ceiling, limit: number, now: Date): Promise<boolean> {
  return takeOne(db, { scope: `ceiling:${ceiling}`, key: "all", window: indiaDate(now), limit });
}

/** Whether today's ceiling is reached already. Counts nothing. */
export function ceilingReached(db: D1Database, ceiling: Ceiling, limit: number, now: Date): Promise<boolean> {
  return isSpent(db, { scope: `ceiling:${ceiling}`, key: "all", window: indiaDate(now), limit });
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
      `The daily ${ceiling} ceiling (${String(limit)}) is reached; ${STOPPED[ceiling]} answer "busy" until midnight IST.`,
    );
}

// Global daily ceilings. The render ceiling caps AILabTools spend; the upload,
// render and result-read ceilings together cap R2 use inside the free tier
// (docs/decisions/0009-stay-inside-cloudflare-free-tier.md); the geocode
// ceiling caps what the address search can spend on the owner's Google card
// (docs/decisions/0054-address-capture.md). A breach answers 503 busy and
// alerts, at most once a day per ceiling.

import type { Alert } from "../providers/alerts.ts";
import { limitOf } from "../policy/rate-limits.ts";
import { isSpent, takeOne, type CountedAt } from "./rate-limit.ts";

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
export function takeFromCeiling(db: D1Database, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  return takeOne(db, `ceiling:${ceiling}`, "all", at);
}

/** Whether today's ceiling is reached already. Counts nothing. */
export function ceilingReached(db: D1Database, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  return isSpent(db, `ceiling:${ceiling}`, "all", at);
}

export async function alertCeilingReached(
  db: D1Database,
  alert: Alert,
  ceiling: Ceiling,
  at: CountedAt,
): Promise<void> {
  const first = await takeOne(db, "alert:ceiling", ceiling, at);
  const limit = limitOf(`ceiling:${ceiling}`, at.settings);
  if (first)
    await alert(
      `The daily ${ceiling} ceiling (${String(limit)}) is reached; ${STOPPED[ceiling]} answer "busy" until midnight IST.`,
    );
}

/** Counts one use against today's ceiling; false, with one alert a day, once the ceiling is reached. */
export async function withinCeiling(db: D1Database, alert: Alert, ceiling: Ceiling, at: CountedAt): Promise<boolean> {
  if (await takeFromCeiling(db, ceiling, at)) return true;
  await alertCeilingReached(db, alert, ceiling, at);
  return false;
}

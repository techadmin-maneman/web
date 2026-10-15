// Zoho Books' calls today, as src/providers/zoho-http.ts counts each by India's day, against the organisation's
// allowance: past it, every invoice, receipt and write to Books fails until the day resets, so ops are told well
// before. Each environment counts its own calls; until staging has a Books organisation of its own
// (docs/decisions/0200-staging-tenants-of-its-own.md), production's count misses staging's calls on the same one.

import { ALERT_WORDS } from "../../config/alert-words.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { ZOHO_CALLS_SCOPE } from "../../providers/zoho-http.ts";
import type { AlertOnce, ResolveAlert } from "../platform/alerts.ts";

/** Zoho Books Professional's API calls a day for one organisation (Zoho Books API, "API Call Limit"). */
export const BOOKS_DAILY_CALLS = 5000;

/** Ops are told once today's calls reach this share of the allowance. */
const TOLD_AT_PERCENT = 70;

/** Today's calls to Books, told past the share, and the alert closed below it, as it is once the day resets. */
export async function tellOfBooksCalls(
  db: D1Database,
  alerts: { readonly alertOnce: AlertOnce; readonly resolveAlert: ResolveAlert },
  now: Date,
): Promise<number> {
  const calls =
    (await db
      .prepare("SELECT count FROM counters WHERE scope = ?1 AND key = 'books' AND window_start = ?2")
      .bind(ZOHO_CALLS_SCOPE, indiaDate(now))
      .first<number>("count")) ?? 0;
  if (calls * 100 < BOOKS_DAILY_CALLS * TOLD_AT_PERCENT) {
    await alerts.resolveAlert("books_calls_high");
    return calls;
  }
  await alerts.alertOnce({
    key: "books_calls_high",
    message: ALERT_WORDS.books_calls_high({ calls, allowance: BOOKS_DAILY_CALLS }),
  });
  return calls;
}

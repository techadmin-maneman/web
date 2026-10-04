// Once an hour: what the Cloudflare account has used today of the free plan's daily allowances. Ops are told once
// when one reaches 70%, while there is still time to find what is spending it, and the alert closes when the day's
// figures start again at midnight UTC. Staging and production share the account, so the figures are both together.

import { CLOUDFLARE_ACCOUNT_ID } from "../config/environments.ts";
import type { Dependencies } from "../dependencies.ts";
import { isAlertOpen } from "../domain/alerts.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";
import {
  ALLOWANCES,
  DAILY_ALLOWANCES,
  isNearlySpent,
  percentUsed,
  type Allowance,
} from "../policy/daily-allowances.ts";
import { readDailyUsage } from "../providers/cloudflare-usage.ts";

/** One failed read can be a blip in Cloudflare's analytics; three in a row leave the allowances unwatched for hours. */
const FAILED_READS_BEFORE_ALERT = 3;

const UNREADABLE_KEY = "daily_allowances_unreadable";

const WHAT_IS_COUNTED: Readonly<Record<Allowance, string>> = {
  queueOperations: "queue operations",
  d1RowsRead: "D1 rows read",
  d1RowsWritten: "D1 rows written",
};

const WHAT_STOPS: Readonly<Record<Allowance, string>> = {
  queueOperations: "every queue send fails, and bookings, payment confirmations, CRM updates and messages stall",
  d1RowsRead: "D1 refuses every query, and the site, the apps and the console stop working",
  d1RowsWritten: "D1 refuses every write, and nothing can be booked, paid for or changed",
};

export interface AllowanceCheck {
  readonly db: D1Database;
  readonly deps: Pick<Dependencies, "fetch" | "now" | "alertOnce" | "resolveAlert">;
  /** CLOUDFLARE_ANALYTICS_TOKEN. */
  readonly token: string;
  readonly log: Logger;
  readonly budget: CallBudget;
}

export async function checkDailyAllowances(check: AllowanceCheck): Promise<void> {
  const { deps, log } = check;
  if (!check.budget.spend(1)) return;

  const reading = await readDailyUsage({
    token: check.token,
    accountId: CLOUDFLARE_ACCOUNT_ID,
    date: utcDay(deps.now()),
    fetch: deps.fetch,
    log,
  });
  if ("unreadable" in reading) {
    log.warn("daily_allowances_unreadable", { reason: reading.unreadable });
    await deps.alertOnce({
      key: UNREADABLE_KEY,
      message:
        `Cloudflare's usage figures could not be read three hours running (${reading.unreadable}), so nobody is ` +
        'told as the daily free allowances run low. Check the token (runbook, "The daily allowances").',
      after: FAILED_READS_BEFORE_ALERT,
    });
    return;
  }

  await deps.resolveAlert(UNREADABLE_KEY);
  log.info("daily_allowances_read", { ...reading.usage });
  for (const allowance of ALLOWANCES) {
    await tellIfNearlySpent(check, allowance, reading.usage[allowance]);
  }
}

/** Told once while the allowance is past the mark; closed once it is under it, which a new day brings. */
async function tellIfNearlySpent(check: AllowanceCheck, allowance: Allowance, used: number): Promise<void> {
  const key = `daily_allowance:${allowance}`;
  const told = await isAlertOpen(check.db, key);
  if (!isNearlySpent(allowance, used)) {
    if (told) await check.deps.resolveAlert(key);
    return;
  }
  if (told) return;
  await check.deps.alertOnce({ key, message: nearlySpentMessage(allowance, used) });
}

function nearlySpentMessage(allowance: Allowance, used: number): string {
  const allowed = DAILY_ALLOWANCES[allowance];
  return (
    `Cloudflare's free ${WHAT_IS_COUNTED[allowance]} are ${String(percentUsed(allowance, used))}% used today: ` +
    `${withCommas(used)} of ${withCommas(allowed)}, staging and production together. Past the limit, until ` +
    `05:30 IST, ${WHAT_STOPS[allowance]}. Find what is spending them (runbook, "The daily allowances").`
  );
}

/** The day the allowances count, which starts at midnight UTC: "2026-10-02". */
function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function withCommas(figure: number): string {
  return figure.toLocaleString("en-US");
}

// The Workers Free plan's daily allowances that can run out in a day, and when ops are warned. Past one, Cloudflare
// refuses that kind of work until midnight UTC. Staging and production share one account, and so each allowance.

export const RULES = [
  "ops are told once when the account has used 70% of a daily allowance, and again only on a later day",
] as const;

/** Per Cloudflare's pricing pages. Each starts again at midnight UTC. */
export const DAILY_ALLOWANCES = {
  queueOperations: 10_000,
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
} as const;

export type Allowance = keyof typeof DAILY_ALLOWANCES;

export const ALLOWANCES = Object.keys(DAILY_ALLOWANCES) as Allowance[];

/** Early enough to find what is spending an allowance before the work it pays for is refused. */
export const WARN_AT_PERCENT = 70;

export function percentUsed(allowance: Allowance, used: number): number {
  return Math.floor((used * 100) / DAILY_ALLOWANCES[allowance]);
}

export function isNearlySpent(allowance: Allowance, used: number): boolean {
  return percentUsed(allowance, used) >= WARN_AT_PERCENT;
}

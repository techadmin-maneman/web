// What clients' photographs and referral cards may hold of R2, and when ops are told
// (docs/decisions/0093-the-storage-meter.md, 0194-the-build-on-workers-paid.md). They have a share of R2's free 10 GB,
// and R2's paid storage is accepted as the share fills, so a full share is told, never refused. What is refused is a
// runaway: uploads at a rate no day's work makes. src/domain/platform/storage-meter.ts keeps the figure these are read
// against.

import type { EnvironmentName } from "../config/environments.ts";

/** The photographs' and cards' share of R2's free 10 GB, in decimal bytes, as Cloudflare bills them. */
export const PHOTO_SHARE_BYTES = 4e9;

/**
 * Each environment's part of the share. R2's free storage is the account's, staging's and production's together, so
 * each meter is read against its own part: staging, which holds a few test visits, a tenth; production the rest.
 */
export const SHARE_BYTES: Readonly<Record<EnvironmentName, number>> = {
  local: 0.4e9,
  staging: 0.4e9,
  production: 3.6e9,
};

/** Ops are told once as the figure reaches each, then at each whole share more, as R2 bills for it. */
const TOLD_AT_PERCENT = [50, 80, 100] as const;

/** The highest mark the figure has reached of `shareBytes`, as a percentage of it, or null below the first. */
export function markReached(heldBytes: number, shareBytes: number): number | null {
  const percent = (heldBytes / shareBytes) * 100;
  if (percent >= 100) return Math.floor(percent / 100) * 100;
  return TOLD_AT_PERCENT.filter((mark) => percent >= mark).at(-1) ?? null;
}

/**
 * The photographs and small copies one technician's phone may upload in an India day: a day of twelve visits, each
 * with its ten photographs and their copies, every one taken twice. Past it, a broken build or a misused link is
 * refused, and the phone keeps its photographs until the next day or until ops find the cause.
 */
export const PHOTO_UPLOADS_PER_TECHNICIAN_DAILY = 12 * 10 * 2 * 2;

/** The stock photographs ops may upload in an India day, all of them together. */
export const STOCK_PHOTO_UPLOADS_DAILY = 300;

/** A day in which the photographs and cards grow by more than this is told to ops: a hundred visits' at their largest. */
export const UNUSUAL_DAILY_GROWTH_BYTES = 2e9;

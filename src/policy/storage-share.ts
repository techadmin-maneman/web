// What Phase 2's photographs and referral cards may hold of R2, and when ops
// are told (docs/decisions/0093-the-storage-meter.md). ADR 0039 set them a
// share of R2's free 10 GB and planned to refuse uploads once it was full. The
// owner ruled otherwise on 27 September 2026 (docs/open-points.md, item 151):
// R2's paid storage is accepted as the share fills, so a full share is told,
// never refused. What is refused is a runaway, far past anything the business
// makes. src/domain/storage-meter.ts keeps the figure these are read against.

export const RULES = [
  "pay for R2 beyond the free tier when it fills",
  "warns ops at 50% and 80% of the share, and R2's paid storage is accepted as the share fills",
] as const;

/** Phase 2's share of R2's free 10 GB, in decimal bytes, as Cloudflare bills them (ADR 0039). */
export const PHASE_2_SHARE_BYTES = 4e9;

/** Ops are told once as the figure reaches each, the last when the share is full. */
export const TOLD_AT_PERCENT = [50, 80, 100] as const;
export type Mark = (typeof TOLD_AT_PERCENT)[number];

/**
 * Past this, the technician's phone keeps its photographs until ops make room. It is twice R2's free allowance and
 * five times the share: a business that reaches it has been told three times on the way, and a broken build or a
 * misused upload link that runs to it costs about $0.20 a month in storage.
 */
export const RUNAWAY_CEILING_BYTES = 20e9;

/** The highest mark the figure has reached, or null below the first. */
export function markReached(heldBytes: number): Mark | null {
  const percent = (heldBytes / PHASE_2_SHARE_BYTES) * 100;
  const reached = TOLD_AT_PERCENT.filter((mark) => percent >= mark);
  return reached.at(-1) ?? null;
}

/** Whether `incomingBytes` more may be stored. A full share is no reason to refuse; only the runaway ceiling is. */
export const hasRoom = (heldBytes: number, incomingBytes: number): boolean =>
  heldBytes + incomingBytes <= RUNAWAY_CEILING_BYTES;

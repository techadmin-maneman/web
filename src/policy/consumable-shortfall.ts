// A job that records less than its service expects of a consumable, or nothing at all on a fit, a service or a
// replacement, says why (docs/decisions/0222-consumables-short-of-expected.md): the step is refused without a reason,
// and ops are given a task. The phone holds itself to the same rule before it sends.

import type { VisitType } from "../config/visit-types.ts";

/** Why a job used less than expected, as the technician picks it. */
export const SHORT_REASONS = ["client_supplies", "ran_out", "not_needed", "other"] as const;
export type ShortReason = (typeof SHORT_REASONS)[number];

/** One consumable recorded below what the service expects of it. */
interface ShortLine {
  readonly code: string;
  readonly expected: number;
  readonly used: number;
}

export interface Shortfall {
  /** Each consumable the service expects, recorded below it. */
  readonly short: readonly ShortLine[];
  /** Nothing recorded at all on a visit that always uses something: every visit but a consultation. */
  readonly nothing: boolean;
}

/** What a job recorded against what its service expects. */
export function shortfallOf(input: {
  readonly type: VisitType;
  readonly expected: readonly { readonly code: string; readonly expected: number }[];
  /** What was recorded, by code; `total` counts every line, a name from an older phone's step too. */
  readonly used: ReadonlyMap<string, number>;
  readonly total: number;
}): Shortfall {
  const short = input.expected
    .filter((each) => each.expected > 0 && (input.used.get(each.code) ?? 0) < each.expected)
    .map((each) => ({ code: each.code, expected: each.expected, used: input.used.get(each.code) ?? 0 }));
  return { short, nothing: input.type !== "consultation" && input.total === 0 };
}

/** Whether the step must say why. */
export const needsReason = (shortfall: Shortfall): boolean => shortfall.short.length > 0 || shortfall.nothing;

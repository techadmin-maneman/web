// Each stock code whose supplier's lead time, and one period, runs past the forecast's horizon (docs/decisions/0319-
// rules-that-hold-together.md): the supply plan covers that lead time in periods (./supply-plan.ts), so past the
// horizon it orders against periods the forecast never filled. The plan flags each, and Settings refuses a horizon,
// or a period, that would leave one past it.

import { periodsCovering } from "../../policy/supply-plan.ts";

export interface PastHorizon {
  readonly code: string;
  readonly name: string;
  readonly lead_time_days: number;
}

/** The codes past the horizon, by the cheapest supplier's lead time, as the plan picks its supplier; by name. */
export async function leadsPastHorizon(
  db: D1Database,
  planning: { readonly periodDays: number; readonly horizonPeriods: number },
): Promise<PastHorizon[]> {
  const { results } = await db
    .prepare(
      `SELECT i.consumable_code AS code, c.name, i.lead_time_days, i.unit_price
       FROM supplier_items i JOIN suppliers s ON s.id = i.supplier_id JOIN consumables c ON c.code = i.consumable_code
       WHERE s.retired_at IS NULL ORDER BY i.consumable_code, i.unit_price`,
    )
    .all<PastHorizon & { unit_price: number }>();
  const cheapest = new Map<string, PastHorizon>();
  for (const row of results) {
    if (!cheapest.has(row.code))
      cheapest.set(row.code, { code: row.code, name: row.name, lead_time_days: row.lead_time_days });
  }
  return [...cheapest.values()]
    .filter((each) => periodsCovering(each.lead_time_days, planning.periodDays) > planning.horizonPeriods)
    .sort((a, b) => a.name.localeCompare(b.name));
}

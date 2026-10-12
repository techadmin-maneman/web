// What each hair system costs us, for the margin figures (docs/decisions/0152-standard-costs.md): Finance's figure per
// first fit and replacement product, until stock lots carry what was paid for each. A figure stands from the day it is
// set; a new one starts from today and never rewrites the past. Each change is audited with codes and the amount.

import { auditStatement, type AuditActor } from "../ops/audit.ts";

export const COSTED_KINDS = ["first_fit", "replacement"] as const;
export type CostedKind = (typeof COSTED_KINDS)[number];

export interface ProductCost {
  readonly item: CostedKind;
  readonly tier: string;
  readonly name: string;
  /** Paise before GST, as it stands today; null while none is set. */
  readonly cost: number | null;
  readonly since: string | null;
}

/** Each first fit and replacement product still sold, with its cost today. */
export async function productCosts(db: D1Database, today: string): Promise<ProductCost[]> {
  const { results } = await db
    .prepare(
      `SELECT s.kind AS item, s.tier, s.name, c.cost, c.valid_from AS since FROM services s
       LEFT JOIN standard_costs c ON c.item = s.kind AND c.tier = s.tier
         AND c.valid_from = (SELECT MAX(x.valid_from) FROM standard_costs x
           WHERE x.item = s.kind AND x.tier = s.tier AND x.valid_from <= ?1)
       WHERE s.kind IN ('first_fit', 'replacement') AND (s.retired_date IS NULL OR s.retired_date > ?1)
       ORDER BY s.kind, s.sort, s.name`,
    )
    .bind(today)
    .all<ProductCost>();
  return results;
}

/** Sets a product's cost from today; "not_found" for no such product still sold. */
export async function setProductCost(
  db: D1Database,
  change: {
    readonly item: CostedKind;
    readonly tier: string;
    readonly cost: number;
    readonly today: string;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<"set" | "not_found"> {
  const sold = await db
    .prepare("SELECT 1 FROM services WHERE kind = ?1 AND tier = ?2 AND (retired_date IS NULL OR retired_date > ?3)")
    .bind(change.item, change.tier, change.today)
    .first();
  if (sold === null) return "not_found";
  await db.batch([
    db
      .prepare(
        `INSERT INTO standard_costs (item, tier, cost, valid_from, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (item, tier, valid_from) DO UPDATE SET cost = excluded.cost, set_by = excluded.set_by,
           set_at = excluded.set_at`,
      )
      .bind(change.item, change.tier, change.cost, change.today, change.actor.id, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "standard_cost.set",
        subject: { kind: "service", id: `${change.item}/${change.tier}` },
        requestId: change.requestId,
        detail: { cost: change.cost },
      },
      change.now,
    ),
  ]);
  return "set";
}

// A month's targets, city by city, set on the console's Targets page (docs/decisions/0154-targets-and-reporting-
// access.md). Setting one again replaces it; taking one off deletes it. Each change is audited with the figure.

import type { TargetMeasure } from "../../policy/targets.ts";
import { auditStatement, type AuditActor } from "./audit.ts";

export interface Target {
  readonly month: string;
  readonly city: string;
  readonly measure: TargetMeasure;
  readonly target: number;
  readonly set_by: string;
  readonly set_at: string;
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

type Which = Pick<Target, "month" | "city" | "measure">;

export async function targetsFor(db: D1Database, month: string): Promise<Target[]> {
  const { results } = await db
    .prepare(
      `SELECT t.month, t.city, t.measure, t.target, t.set_by, t.set_at FROM targets t
       JOIN cities c ON c.name = t.city WHERE t.month = ?1 ORDER BY c.sort, t.measure`,
    )
    .bind(month)
    .all<Target>();
  return results;
}

const audited = (
  db: D1Database,
  change: Change & Which,
  action: "target.set" | "target.remove",
  target: number | null,
) =>
  auditStatement(
    db,
    {
      surface: "ops",
      actor: change.actor,
      action,
      subject: { kind: "target", id: `${change.month}/${change.city}/${change.measure}` },
      requestId: change.requestId,
      detail: { target },
    },
    change.now,
  );

/** Sets a target; "no_city" for a city we do not hold. */
export async function setTarget(
  db: D1Database,
  change: Change & Which & { readonly target: number },
): Promise<"set" | "no_city"> {
  const held = await db.prepare("SELECT 1 FROM cities WHERE name = ?1").bind(change.city).first();
  if (held === null) return "no_city";
  await db.batch([
    db
      .prepare(
        `INSERT INTO targets (month, city, measure, target, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (month, city, measure) DO UPDATE SET target = excluded.target, set_by = excluded.set_by,
           set_at = excluded.set_at`,
      )
      .bind(change.month, change.city, change.measure, change.target, change.actor.id, change.now.toISOString()),
    audited(db, change, "target.set", change.target),
  ]);
  return "set";
}

/** Takes a target off; false for one not set. */
export async function removeTarget(db: D1Database, change: Change & Which): Promise<boolean> {
  const held = await db
    .prepare("SELECT 1 FROM targets WHERE month = ?1 AND city = ?2 AND measure = ?3")
    .bind(change.month, change.city, change.measure)
    .first();
  if (held === null) return false;
  await db.batch([
    db
      .prepare("DELETE FROM targets WHERE month = ?1 AND city = ?2 AND measure = ?3")
      .bind(change.month, change.city, change.measure),
    audited(db, change, "target.remove", null),
  ]);
  return true;
}

// A client's ask for a hair system made to order (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md,
// decision 6), kept as they are told their size is made to order: one a client, visit and package while it is open, a
// task on the board until ops close it, having ordered it, taken payment and booked the fitting (migration 0215).

import type { TaskGroup } from "../../policy/tasks.ts";

export type MadeToOrderKind = "first_fit" | "replacement";

/**
 * The board's queue of asks still open (src/domain/ops/task-queues.ts): the client, the hair system by its package's
 * name, and the visit it is for, from when it was asked.
 */
export const MADE_TO_ORDER_QUEUE: { readonly group: TaskGroup; readonly sql: string } = {
  group: "made_to_order_ask",
  sql: `SELECT 'made_to_order_ask' AS "group", m.id AS id, m.person_id AS person_id, pe.name AS person_name,
         COALESCE(f.name, m.tier) AS detail, json_object('kind', m.kind, 'name', COALESCE(f.name, m.tier)) AS facts,
         m.requested_at AS since, NULL AS due_by, '' AS episode
    FROM made_to_order_asks m INDEXED BY made_to_order_asks_open JOIN people pe ON pe.id = m.person_id
    LEFT JOIN services f ON f.kind = 'first_fit' AND f.tier = m.tier
   WHERE m.settled_at IS NULL AND pe.erased_at IS NULL`,
};

/**
 * Keeps the ask, which the route has found booking would answer as made to order, unless one is open already: when it
 * was first asked. A visit of its kind booked since settles it (migration 0215).
 */
export async function askToOrder(
  db: D1Database,
  ask: { readonly personId: string; readonly kind: MadeToOrderKind; readonly tier: string; readonly now: Date },
): Promise<{ readonly requested_at: string }> {
  const { personId, kind, tier } = ask;
  await db
    .prepare(
      `INSERT OR IGNORE INTO made_to_order_asks (id, person_id, kind, tier, requested_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(crypto.randomUUID(), personId, kind, tier, ask.now.toISOString())
    .run();
  const open = await db
    .prepare(
      `SELECT requested_at FROM made_to_order_asks INDEXED BY made_to_order_asks_open
       WHERE person_id = ?1 AND kind = ?2 AND tier = ?3 AND settled_at IS NULL`,
    )
    .bind(personId, kind, tier)
    .first<{ requested_at: string }>();
  return open ?? { requested_at: ask.now.toISOString() };
}

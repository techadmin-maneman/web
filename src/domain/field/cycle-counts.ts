// Cycle counts come round (docs/decisions/0185-cycle-counts.md): each morning a count task is raised for each place
// and class whose period has passed since its last, and which the place holds; and ops start a count of one place and
// item when they choose, which the morning's leave be. Counting them is ./count-tasks.ts.

import type { CountClass } from "../../policy/cycle-counts.ts";
import { auditStatementIfWritten } from "../ops/audit.ts";
import type { Place } from "./stock-places.ts";
import type { Written } from "./stock.ts";

/**
 * Today's count tasks raised: one for each standing place and class it holds whose last count was done longer ago
 * than the class's period, and has none still open. How many were raised.
 */
export async function raiseCountTasks(
  db: D1Database,
  today: string,
  now: Date,
  classDays: Readonly<Record<CountClass, number>>,
): Promise<number> {
  const raised = await db
    .prepare(
      `INSERT INTO count_tasks (id, place_id, count_class, due_on, state, raised_at)
       SELECT lower(hex(randomblob(16))), p.id, json_each.key, ?1, 'open', ?2
       FROM stock_places p LEFT JOIN technicians t ON t.id = p.technician_id
       CROSS JOIN json_each(?3)
       WHERE (p.kind <> 'kit' OR t.id IS NOT NULL) AND p.active * COALESCE(t.active, 1) = 1
         AND NOT EXISTS (SELECT 1 FROM count_tasks o INDEXED BY count_tasks_open
                         WHERE o.place_id = p.id AND o.count_class = json_each.key AND o.state <> 'done'
                           AND o.consumable_code IS NULL)
         AND NOT EXISTS (SELECT 1 FROM count_tasks d INDEXED BY count_tasks_by_place
                         WHERE d.place_id = p.id AND d.count_class = json_each.key
                           AND d.due_on > date(?1, '-' || json_each.value || ' days') AND d.consumable_code IS NULL)
         AND EXISTS (SELECT 1 FROM stock_balances b INDEXED BY stock_balances_by_place
                     JOIN consumables i ON i.code = b.consumable_code
                     LEFT JOIN hair_systems h ON h.code = b.consumable_code
                     WHERE b.place = p.id AND b.quantity > 0
                       AND COALESCE(i.count_class, CASE WHEN h.code IS NULL THEN 'quarterly' ELSE 'weekly' END) = json_each.key)`,
    )
    .bind(today, now.toISOString(), JSON.stringify(classDays))
    .run();
  return raised.meta.changes;
}

/**
 * A count of one item at one place, started now: due today, of the item's class, for whoever counts there. Refused
 * where the place holds none of it; where one is already open, that one is the answer. The task's ID, or null.
 */
export async function startCount(
  db: D1Database,
  wanted: { readonly place: Place; readonly code: string; readonly today: string },
  written: Written,
): Promise<string | null> {
  const open = await db
    .prepare(
      `SELECT id FROM count_tasks INDEXED BY count_tasks_open
       WHERE place_id = ?1 AND consumable_code = ?2 AND state <> 'done' LIMIT 1`,
    )
    .bind(wanted.place, wanted.code)
    .first<string>("id");
  if (open !== null) return open;
  const id = crypto.randomUUID();
  const [started] = await db.batch([
    db
      .prepare(
        `INSERT INTO count_tasks (id, place_id, count_class, due_on, state, raised_at, consumable_code, started_by)
         SELECT ?1, b.place, COALESCE(i.count_class, CASE WHEN h.code IS NULL THEN 'quarterly' ELSE 'weekly' END), ?4,
           'open', ?5, b.consumable_code, ?6
         FROM stock_balances b JOIN consumables i ON i.code = b.consumable_code
           LEFT JOIN hair_systems h ON h.code = b.consumable_code
         WHERE b.place = ?2 AND b.consumable_code = ?3 AND b.quantity > 0`,
      )
      .bind(id, wanted.place, wanted.code, wanted.today, written.now.toISOString(), written.actor.id),
    auditStatementIfWritten(
      db,
      {
        surface: "ops",
        actor: written.actor,
        action: "count_task.start",
        subject: { kind: "count_task", id },
        requestId: written.requestId,
        detail: { place: wanted.place, consumable_code: wanted.code },
      },
      written.now,
      { table: "count_tasks", id },
    ),
  ]);
  return started?.meta.changes === 1 ? id : null;
}

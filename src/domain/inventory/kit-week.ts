// The week's top-up (docs/decisions/0181-tomorrows-kits.md): on the evening ops set, the kit check looks a week ahead
// for consumables, at what each kit's visits over the next seven days are expected to use and its kit level on top,
// so a kit ends the week no lower than its level. Hair systems stay with tomorrow's check, which knows each client's.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import { tierOf } from "../../config/visit-types.ts";
import { bookedAhead } from "../../config/statuses.ts";

/** How many days from tomorrow the week's top-up covers. */
const TOP_UP_DAYS = 7;

type WeekRow = { kit: string; code: string; quantity: number; level: number };

/** Each active kit's consumables for the week from tomorrow: what its visits are expected to use, and its level. */
async function weeksUse(db: D1Database, tomorrow: string): Promise<WeekRow[]> {
  const { results } = await db
    .prepare(
      `WITH used AS (
         SELECT a.technician_id AS kit, u.consumable_code AS code, SUM(u.quantity) AS quantity
         FROM appointments a JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
         WHERE ${bookedAhead("a")} AND a.technician_id IS NOT NULL GROUP BY 1, 2)
       SELECT p.id AS kit, c.code, COALESCE(used.quantity, 0) AS quantity, COALESCE(c.reorder_kit, 0) AS level
       FROM stock_places p CROSS JOIN consumables c LEFT JOIN used ON used.kit = p.id AND used.code = c.code
       WHERE p.kind = 'kit' AND p.active = 1 AND (c.retired_date IS NULL OR c.retired_date > ?3)
         AND NOT EXISTS (SELECT 1 FROM hair_systems h WHERE h.code = c.code)
         AND (used.quantity IS NOT NULL OR c.reorder_kit IS NOT NULL)`,
    )
    .bind(
      indiaInstant(tomorrow, "00:00").toISOString(),
      indiaInstant(addDays(tomorrow, TOP_UP_DAYS), "00:00").toISOString(),
      tomorrow,
    )
    .all<WeekRow>();
  return results;
}

/**
 * Tomorrow's needs with the week's consumables in: each kit's need of a consumable at least its week's use and its
 * level. The level each adds, by kit and code, so the plan line shows it as the kit's safety stock.
 */
export async function addTheWeek(
  db: D1Database,
  needs: Map<string, Map<string, number>>,
  tomorrow: string,
): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  for (const row of await weeksUse(db, tomorrow)) {
    const kitNeeds = needs.get(row.kit) ?? new Map<string, number>();
    kitNeeds.set(row.code, Math.max(kitNeeds.get(row.code) ?? 0, row.quantity + row.level));
    needs.set(row.kit, kitNeeds);
    levels.set(`${row.kit} ${row.code}`, row.level);
  }
  return levels;
}

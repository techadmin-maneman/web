// The kits short for the visits already allotted to them (docs/decisions/0308-the-inventory-screens-to-the-22-november-redesign.md):
// what each technician's visits booked ahead, allotted at the evening's lock and no longer a draft, are expected to
// use, by each service's expected use and the hair system each fit is made to, beside what their kit holds now. A kit
// short of anything is named with how much it needs sent. The rest of the weeks ahead stays the city's total
// (./stock-demand.ts): a visit not yet allotted has no kit.

import { tierOf } from "../../config/visit-types.ts";
import { bookedAhead } from "../../config/statuses.ts";
import { read, readAll } from "../../lib/read-all.ts";
import { codedFits, FIT_COLUMNS, weeksAhead, type FitRow } from "./stock-demand.ts";

/** One kit short of one stock code for its technician's visits allotted ahead. */
export interface KitShort {
  readonly technicianId: string;
  readonly name: string;
  /** The technician's city; null where none is set. */
  readonly city: string | null;
  readonly code: string;
  readonly expected: number;
  readonly held: number;
}

/** A visit allotted to its technician: given at the evening's lock, not a draft the plan may still move. */
const ALLOTTED = "a.technician_id IS NOT NULL AND a.technician_draft = 0";

/** Every kit short of anything for its technician's visits allotted in the days ahead from `today`. */
export async function kitShortfalls(db: D1Database, today: string, days: number): Promise<KitShort[]> {
  const { from, to } = weeksAhead(today, days);
  const { used, fits, held, technicians } = await readAll(db, {
    used: read<{ tech: string; code: string; expected: number }>(
      db
        .prepare(
          `SELECT a.technician_id AS tech, u.consumable_code AS code, SUM(u.quantity) AS expected
           FROM appointments a
           JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
           WHERE ${bookedAhead("a")} AND ${ALLOTTED}
           GROUP BY 1, 2`,
        )
        .bind(from, to),
    ),
    fits: read<FitRow & { tech: string }>(
      db
        .prepare(
          `SELECT ${FIT_COLUMNS}, a.technician_id AS tech FROM appointments a
           WHERE ${bookedAhead("a")} AND ${ALLOTTED} AND a.type IN ('first_fit', 'replacement')`,
        )
        .bind(from, to),
    ),
    held: read<{ tech: string; code: string; held: number }>(
      db.prepare(
        `SELECT p.technician_id AS tech, b.consumable_code AS code, b.quantity AS held
         FROM stock_balances b JOIN stock_places p ON p.id = b.place
         WHERE p.kind = 'kit' AND p.technician_id IS NOT NULL`,
      ),
    ),
    technicians: read<{ id: string; name: string; city: string | null }>(
      db.prepare("SELECT id, name, city FROM technicians"),
    ),
  });
  const expected = new Map<string, number>();
  const add = (tech: string, code: string, quantity: number) => {
    const key = `${tech}|${code}`;
    expected.set(key, (expected.get(key) ?? 0) + quantity);
  };
  for (const row of used) add(row.tech, row.code, row.expected);
  for (const { fit, code } of await codedFits(db, fits)) {
    if (code !== null) add(fit.tech, code, 1);
  }
  const holds = new Map(held.map((row) => [`${row.tech}|${row.code}`, row.held]));
  const byId = new Map(technicians.map((row) => [row.id, row]));
  return [...expected].flatMap(([key, quantity]): KitShort[] => {
    const [tech = "", code = ""] = key.split("|");
    const kit = holds.get(key) ?? 0;
    const technician = byId.get(tech);
    if (quantity <= kit || technician === undefined) return [];
    return [{ technicianId: tech, name: technician.name, city: technician.city, code, expected: quantity, held: kit }];
  });
}

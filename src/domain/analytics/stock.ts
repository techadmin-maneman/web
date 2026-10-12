// Consumable stock in the reporting copy (docs/decisions/0153-supply-and-credits-in-the-copy.md), from today's ledger:
// each consumable, each place stock is kept (the central store and each technician's kit), every movement, and each
// week's position per place and consumable: what was on hand at its end and its value, what visits used, what the
// visits done were expected to use, and whether it ended at or below its reorder level. Value is at today's unit cost.
// Kits of technicians marked as tests are left out.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";

interface Item {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly unit_cost: number;
  readonly reorder_kit: number | null;
  readonly reorder_central: number | null;
}

interface Movement {
  readonly id: string;
  readonly created_at: string;
  readonly technician_id: string | null;
  readonly code: string;
  readonly reason: string;
  readonly quantity: number;
  readonly appointment_id: string | null;
}

interface Expected {
  readonly technician_id: string;
  readonly window_start: string;
  readonly code: string;
  readonly quantity: number;
}

const placeOf = (technicianId: string | null) => (technicianId === null ? "central" : `kit:${technicianId}`);

/** The Monday a day's week starts on. */
const weekOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

interface Week {
  on_hand: number;
  used: number;
  expected: number;
}

/** Each place and consumable's weeks, from the week of its first movement to tonight's. */
function weeksOf(movements: readonly Movement[], expected: readonly Expected[], today: string) {
  const changes = new Map<string, Map<string, Week>>();
  const touch = (pair: string, week: string) => {
    const weeks = changes.get(pair) ?? new Map<string, Week>();
    const held = weeks.get(week) ?? { on_hand: 0, used: 0, expected: 0 };
    weeks.set(week, held);
    changes.set(pair, weeks);
    return held;
  };
  for (const move of movements) {
    const week = touch(`${placeOf(move.technician_id)}|${move.code}`, weekOf(indiaDate(new Date(move.created_at))));
    week.on_hand += move.quantity;
    if (move.reason === "used") week.used -= move.quantity;
  }
  for (const visit of expected) {
    touch(`${placeOf(visit.technician_id)}|${visit.code}`, weekOf(indiaDate(new Date(visit.window_start)))).expected +=
      visit.quantity;
  }
  const rows: { place: string; code: string; week: string; on_hand: number; used: number; expected: number }[] = [];
  for (const [pair, weeks] of changes) {
    const [place = "", code = ""] = pair.split("|");
    let onHand = 0;
    const first = [...weeks.keys()].sort()[0] ?? weekOf(today);
    for (let week = first; week <= weekOf(today); week = addDays(week, 7)) {
      const held = weeks.get(week);
      onHand += held?.on_hand ?? 0;
      if (onHand === 0 && held === undefined) continue;
      rows.push({ place, code, week, on_hand: onHand, used: held?.used ?? 0, expected: held?.expected ?? 0 });
    }
  }
  return rows;
}

export async function stockTables(db: D1Database, today: string): Promise<readonly TableRows[]> {
  const [items, technicians, movements, expected] = await db.batch<
    Item | { id: string; city: string | null } | Movement | Expected
  >([
    db.prepare("SELECT code, name, unit, unit_cost, reorder_kit, reorder_central FROM consumables"),
    db.prepare("SELECT id, city FROM technicians WHERE test_record = 0"),
    db.prepare(
      `SELECT m.id, m.created_at, m.technician_id, m.consumable_code AS code, m.reason, m.quantity, m.appointment_id
       FROM stock_movements m LEFT JOIN technicians t ON t.id = m.technician_id
       WHERE m.technician_id IS NULL OR t.test_record = 0`,
    ),
    db.prepare(
      `SELECT a.technician_id, a.window_start, u.consumable_code AS code, u.quantity
       FROM appointments a JOIN technicians t ON t.id = a.technician_id AND t.test_record = 0
       JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = COALESCE(a.tier, 'standard')
       WHERE a.status = 'completed' AND a.deleted_at IS NULL`,
    ),
  ]);
  const catalogue = (items?.results ?? []) as Item[];
  const byCode = new Map(catalogue.map((item) => [item.code, item]));
  const kits = (technicians?.results ?? []) as { id: string; city: string | null }[];
  const moves = (movements?.results ?? []) as Movement[];
  const valueOf = (code: string, quantity: number) => Math.round(quantity * (byCode.get(code)?.unit_cost ?? 0)) / 100;
  const reorderAt = (place: string, code: string) =>
    place === "central" ? byCode.get(code)?.reorder_central : byCode.get(code)?.reorder_kit;

  const weeks: Row[] = weeksOf(moves, (expected?.results ?? []) as Expected[], today).map((week) => {
    const level = reorderAt(week.place, week.code);
    return {
      week_start: week.week,
      place_key: week.place,
      item_code: week.code,
      on_hand: week.on_hand,
      value: valueOf(week.code, week.on_hand),
      used: week.used,
      expected: week.expected,
      alerts: level !== null && level !== undefined && week.on_hand <= level ? 1 : 0,
    };
  });
  return [
    {
      table: "dim_item",
      key: ["item_code"],
      stamped: false,
      rows: catalogue.map((item) => ({
        item_code: item.code,
        name: item.name,
        unit: item.unit,
        unit_cost: item.unit_cost / 100,
      })),
    },
    {
      table: "dim_stock_place",
      key: ["place_key"],
      stamped: false,
      rows: [
        { place_key: "central", kind: "store", city: null, technician_key: null },
        ...kits.map((kit) => ({ place_key: placeOf(kit.id), kind: "kit", city: kit.city, technician_key: kit.id })),
      ],
    },
    {
      table: "fact_stock_movement",
      key: ["movement_key"],
      stamped: true,
      rows: moves.map((move) => ({
        movement_key: move.id,
        movement_date: indiaDate(new Date(move.created_at)),
        place_key: placeOf(move.technician_id),
        item_code: move.code,
        kind: move.reason,
        quantity: move.quantity,
        value: valueOf(move.code, move.quantity),
        visit_key: move.appointment_id,
      })),
    },
    { table: "fact_stock_week", key: ["week_start", "place_key", "item_code"], stamped: true, rows: weeks },
  ];
}

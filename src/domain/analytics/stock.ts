// Consumable stock in the reporting copy (docs/decisions/0153-supply-and-credits-in-the-copy.md), from today's ledger:
// each consumable, each place stock is kept (the warehouse, hubs, stockrooms and kits), every movement, and each
// week's position per place and consumable: what was on hand at its end and its value, what visits used, what the
// visits done were expected to use, and whether it ended at or below its reorder level. Value is at today's unit cost.
// Kits of technicians marked as tests are left out.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { levelAt } from "../../policy/stock.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import { tierOf } from "../../config/visit-types.ts";

interface Item {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly unit_cost: number;
  readonly reorder_kit: number | null;
  readonly reorder_central: number | null;
  readonly reorder_store: number | null;
}

interface Movement {
  readonly id: string;
  readonly created_at: string;
  readonly place: string;
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

interface StockPlace {
  readonly id: string;
  readonly kind: string;
  readonly city: string | null;
  readonly technician_id: string | null;
}

/** A place's key in the copy: the warehouse keeps the central store's, a kit and any other place their kind and ID. */
const keyOf = (place: { readonly id: string; readonly kind: string }) =>
  place.kind === "warehouse" ? "central" : `${place.kind}:${place.id}`;

/** The copy's word for each kind: the warehouse as the store the dashboards know. */
const KIND_WORDS: Readonly<Record<string, string>> = { warehouse: "store" };

/** The Monday a day's week starts on. */
const weekOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

interface Week {
  on_hand: number;
  used: number;
  expected: number;
}

/** Each place and consumable's weeks, from the week of its first movement to tonight's. */
function weeksOf(
  movements: readonly Movement[],
  expected: readonly Expected[],
  { today, placeKey }: { readonly today: string; readonly placeKey: (id: string) => string },
) {
  const changes = new Map<string, Map<string, Week>>();
  const touch = (pair: string, week: string) => {
    const weeks = changes.get(pair) ?? new Map<string, Week>();
    const held = weeks.get(week) ?? { on_hand: 0, used: 0, expected: 0 };
    weeks.set(week, held);
    changes.set(pair, weeks);
    return held;
  };
  for (const move of movements) {
    const week = touch(`${placeKey(move.place)}|${move.code}`, weekOf(indiaDate(new Date(move.created_at))));
    week.on_hand += move.quantity;
    if (move.reason === "used") week.used -= move.quantity;
  }
  for (const visit of expected) {
    touch(`${placeKey(visit.technician_id)}|${visit.code}`, weekOf(indiaDate(new Date(visit.window_start)))).expected +=
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

/** The catalogue, the places, the ledger and what each completed visit was expected to use. */
async function readStock(db: D1Database) {
  const [items, places, movements, expected] = await db.batch<Item | StockPlace | Movement | Expected>([
    db.prepare("SELECT code, name, unit, unit_cost, reorder_kit, reorder_central, reorder_store FROM consumables"),
    db.prepare(
      `SELECT p.id, p.kind, COALESCE(p.city, t.city) AS city, p.technician_id
       FROM stock_places p LEFT JOIN technicians t ON t.id = p.technician_id
       WHERE p.technician_id IS NULL OR t.test_record = 0`,
    ),
    db.prepare(
      `SELECT m.id, m.created_at, COALESCE(m.place_id, m.technician_id, 'central') AS place,
         m.consumable_code AS code, m.reason, m.quantity, m.appointment_id
       FROM stock_movements m LEFT JOIN technicians t ON t.id = m.technician_id
       WHERE m.technician_id IS NULL OR t.test_record = 0`,
    ),
    db.prepare(
      `SELECT a.technician_id, a.window_start, u.consumable_code AS code, u.quantity
       FROM appointments a JOIN technicians t ON t.id = a.technician_id AND t.test_record = 0
       JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
       WHERE a.status = 'completed' AND a.deleted_at IS NULL`,
    ),
  ]);
  return {
    catalogue: (items?.results ?? []) as Item[],
    places: (places?.results ?? []) as StockPlace[],
    moves: (movements?.results ?? []) as Movement[],
    expected: (expected?.results ?? []) as Expected[],
  };
}

export async function stockTables(db: D1Database, today: string): Promise<readonly TableRows[]> {
  const { catalogue, places, moves, expected } = await readStock(db);
  const byCode = new Map(catalogue.map((item) => [item.code, item]));
  const keys = new Map(places.map((place) => [place.id, keyOf(place)]));
  const placeKey = (id: string) => keys.get(id) ?? `kit:${id}`;
  const valueOf = (code: string, quantity: number) => Math.round(quantity * (byCode.get(code)?.unit_cost ?? 0)) / 100;
  const reorderAt = (place: string, code: string) => {
    const item = byCode.get(code);
    if (item === undefined) return null;
    const levels = {
      reorderKit: item.reorder_kit,
      reorderCentral: item.reorder_central,
      reorderStore: item.reorder_store,
    };
    return levelAt(levels, place === "central" ? "warehouse" : (place.split(":")[0] ?? ""));
  };

  const weeks: Row[] = weeksOf(moves, expected, { today, placeKey }).map((week) => {
    const level = reorderAt(week.place, week.code);
    return {
      week_start: week.week,
      place_key: week.place,
      item_code: week.code,
      on_hand: week.on_hand,
      value: valueOf(week.code, week.on_hand),
      used: week.used,
      expected: week.expected,
      alerts: level !== null && week.on_hand <= level ? 1 : 0,
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
      rows: places.map((place) => ({
        place_key: keyOf(place),
        kind: KIND_WORDS[place.kind] ?? place.kind,
        city: place.city,
        technician_key: place.technician_id,
      })),
    },
    {
      table: "fact_stock_movement",
      key: ["movement_key"],
      stamped: true,
      rows: moves.map((move) => ({
        movement_key: move.id,
        movement_date: indiaDate(new Date(move.created_at)),
        place_key: placeKey(move.place),
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

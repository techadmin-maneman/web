// Usage against expected, and shrinkage (docs/decisions/0186-usage-and-shrinkage.md): over the last weeks, what each
// technician's visits were expected to use of each consumable, by the service's expected use, beside what they used;
// and for each place what left it, what of that was lost, counted short or written off, and how often its counts
// were right the first time. Hair systems are left out of usage: a fit takes one piece, which the piece step names.

import {
  countAccuracyPercent,
  kitFlagged,
  overPercent,
  shrinkagePercent,
  technicianFlagged,
} from "../../policy/stock-usage.ts";
import { allPlaces, type Place } from "./stock-places.ts";

interface ItemUsage {
  readonly code: string;
  readonly name: string;
  readonly expected: number;
  readonly used: number;
  readonly overPercent: number | null;
}

export interface TechnicianUsage {
  readonly technicianId: string;
  readonly name: string;
  readonly visits: number;
  /** Valued at each item's cost, so items of different units add up. */
  readonly expectedValue: number;
  readonly usedValue: number;
  readonly overPercent: number | null;
  readonly flagged: boolean;
  readonly items: ItemUsage[];
}

export interface PlaceLoss {
  readonly placeId: Place;
  readonly place: string;
  readonly kind: string;
  readonly leftValue: number;
  readonly lostValue: number;
  readonly writeOffs: number;
  readonly shrinkagePercent: number | null;
  readonly countAccuracyPercent: number | null;
  readonly flagged: boolean;
}

type VisitRow = { technician_id: string; type: string; tier: string; visits: number };
type UseRow = { visit_type: string; tier: string; code: string; quantity: number };
type UsedRow = { technician_id: string; code: string; used: number };
type ItemRow = { code: string; name: string; unit_cost: number; hair_system: number };

/** Each technician in the places given (null for every place) with visits done since the day, their use beside expected. */
export async function usageAgainstExpected(
  db: D1Database,
  since: string,
  within: ReadonlySet<Place> | null,
): Promise<TechnicianUsage[]> {
  const [visits, usage, used, items, technicians] = await db.batch<
    VisitRow | UseRow | UsedRow | ItemRow | { id: string; name: string }
  >([
    db
      .prepare(
        `SELECT technician_id, type, COALESCE(tier, 'standard') AS tier, COUNT(*) AS visits
         FROM appointments INDEXED BY appointments_done_visits
         WHERE status = 'completed' AND type IN ('first_fit', 'service', 'replacement') AND deleted_at IS NULL
           AND window_start >= ?1 AND technician_id IS NOT NULL GROUP BY 1, 2, 3`,
      )
      .bind(since),
    db.prepare("SELECT visit_type, tier, consumable_code AS code, quantity FROM consumable_usage"),
    db
      .prepare(
        `SELECT technician_id, consumable_code AS code, SUM(-quantity) AS used
         FROM stock_movements INDEXED BY stock_movements_used_by_day
         WHERE reason = 'used' AND created_at >= ?1 AND technician_id IS NOT NULL GROUP BY 1, 2`,
      )
      .bind(since),
    db.prepare(
      `SELECT c.code, c.name, c.unit_cost, h.code IS NOT NULL AS hair_system
       FROM consumables c LEFT JOIN hair_systems h ON h.code = c.code`,
    ),
    db.prepare("SELECT id, name FROM technicians"),
  ]);
  const itemOf = new Map(((items?.results ?? []) as ItemRow[]).map((row) => [row.code, row]));
  const nameOf = new Map(
    ((technicians?.results ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]),
  );
  const counted = tally(
    (visits?.results ?? []) as VisitRow[],
    (usage?.results ?? []) as UseRow[],
    ((used?.results ?? []) as UsedRow[]).filter((row) => itemOf.get(row.code)?.hair_system !== 1),
  );
  return [...counted]
    .filter(([technician]) => within === null || within.has(technician))
    .map(([technicianId, tallied]) => usageOf(technicianId, nameOf.get(technicianId) ?? technicianId, tallied, itemOf))
    .sort(
      (a, b) => Number(b.flagged) - Number(a.flagged) || (b.overPercent ?? -Infinity) - (a.overPercent ?? -Infinity),
    );
}

interface Tallied {
  visits: number;
  readonly expected: Map<string, number>;
  readonly used: Map<string, number>;
}

/** Each technician's visits, what they were expected to use of each code, and what they used. */
function tally(visits: readonly VisitRow[], uses: readonly UseRow[], used: readonly UsedRow[]): Map<string, Tallied> {
  const counted = new Map<string, Tallied>();
  const of = (technician: string): Tallied => {
    const found = counted.get(technician) ?? {
      visits: 0,
      expected: new Map<string, number>(),
      used: new Map<string, number>(),
    };
    counted.set(technician, found);
    return found;
  };
  for (const row of visits) {
    const technician = of(row.technician_id);
    technician.visits += row.visits;
    for (const use of uses.filter((each) => each.visit_type === row.type && each.tier === row.tier)) {
      technician.expected.set(use.code, (technician.expected.get(use.code) ?? 0) + use.quantity * row.visits);
    }
  }
  for (const row of used) {
    const technician = of(row.technician_id);
    technician.used.set(row.code, (technician.used.get(row.code) ?? 0) + row.used);
  }
  return counted;
}

/** One technician's tally, valued at cost and flagged, each item with how far it ran over. */
function usageOf(
  technicianId: string,
  name: string,
  tallied: Tallied,
  itemOf: ReadonlyMap<string, ItemRow>,
): TechnicianUsage {
  const valueOf = (amounts: ReadonlyMap<string, number>) =>
    [...amounts].reduce((total, [code, quantity]) => total + quantity * (itemOf.get(code)?.unit_cost ?? 0), 0);
  const expectedValue = valueOf(tallied.expected);
  const usedValue = valueOf(tallied.used);
  const over = overPercent(usedValue, expectedValue);
  const codes = [...new Set([...tallied.expected.keys(), ...tallied.used.keys()])];
  return {
    technicianId,
    name,
    visits: tallied.visits,
    expectedValue,
    usedValue,
    overPercent: over,
    flagged: technicianFlagged(over, tallied.visits),
    items: codes
      .map((code) => ({
        code,
        name: itemOf.get(code)?.name ?? code,
        expected: tallied.expected.get(code) ?? 0,
        used: tallied.used.get(code) ?? 0,
        overPercent: overPercent(tallied.used.get(code) ?? 0, tallied.expected.get(code) ?? 0),
      }))
      .sort((a, b) => (b.overPercent ?? -Infinity) - (a.overPercent ?? -Infinity)),
  };
}

type LeftRow = { place: string; reason: string; value: number; moves: number };
type CountedRow = { place_id: string; lines: number; right: number };

/** Each place in the places given (null for every place) that anything left since the instant, or that counted. */
export async function shrinkage(
  db: D1Database,
  since: string,
  within: ReadonlySet<Place> | null,
): Promise<PlaceLoss[]> {
  const [left, counts] = await db.batch<LeftRow | CountedRow>([
    db
      .prepare(
        `SELECT COALESCE(m.place_id, m.technician_id, 'central') AS place, m.reason, SUM(-m.quantity * c.unit_cost) AS value,
           COUNT(*) AS moves
         FROM stock_movements m INDEXED BY stock_movements_latest JOIN consumables c ON c.code = m.consumable_code
         WHERE m.created_at >= ?1 AND m.quantity < 0 GROUP BY 1, 2`,
      )
      .bind(since),
    db
      .prepare(
        `SELECT t.place_id, COUNT(*) AS lines, SUM(l.recounted IS NULL) AS right
         FROM count_tasks t INDEXED BY count_tasks_done JOIN count_lines l ON l.task_id = t.id
         WHERE t.state = 'done' AND t.done_at >= ?1 GROUP BY 1`,
      )
      .bind(since),
  ]);
  const leftRows = (left?.results ?? []) as LeftRow[];
  const countRows = (counts?.results ?? []) as CountedRow[];
  return (await allPlaces(db))
    .filter((place) => within === null || within.has(place.id))
    .flatMap((place): PlaceLoss[] => {
      const rows = leftRows.filter((row) => row.place === place.id);
      const counted = countRows.find((row) => row.place_id === place.id);
      if (rows.length === 0 && counted === undefined) return [];
      const leftValue = rows.reduce((total, row) => total + row.value, 0);
      const lost = rows.filter((row) => row.reason === "counted" || row.reason === "written_off");
      const lostValue = lost.reduce((total, row) => total + row.value, 0);
      const writeOffs = rows.find((row) => row.reason === "written_off")?.moves ?? 0;
      return [
        {
          placeId: place.id,
          place: place.name,
          kind: place.kind,
          leftValue,
          lostValue,
          writeOffs,
          shrinkagePercent: shrinkagePercent(lostValue, leftValue),
          countAccuracyPercent: countAccuracyPercent(counted?.right ?? 0, counted?.lines ?? 0),
          flagged: kitFlagged(place.kind, writeOffs),
        },
      ];
    })
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.shrinkagePercent ?? -1) - (a.shrinkagePercent ?? -1));
}

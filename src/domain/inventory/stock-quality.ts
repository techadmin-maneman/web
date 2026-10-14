// Failure rates and value at risk (docs/decisions/0188-failure-rates-and-value-at-risk.md), read on demand for the
// Quality page. Failure rates: the labelled pieces fitted in the last year, and how many failed, by stock code, lot,
// supplier and the technician who fitted them. Value at risk: each lot a place holds, against how fast the place
// lets the item go, and what of it will still be there when it expires, valued at the lot's landed cost.

import { failureRatePercent, unusedByExpiry } from "../../policy/stock-quality.ts";
import { allPlaces, type Place } from "./stock-places.ts";

export interface FailureGroup {
  readonly name: string;
  readonly fitted: number;
  readonly failed: number;
  readonly ratePercent: number | null;
}

export interface FailureRates {
  readonly byCode: FailureGroup[];
  readonly byLot: FailureGroup[];
  readonly bySupplier: FailureGroup[];
  readonly byTechnician: FailureGroup[];
}

type FitRow = {
  failed: number;
  name: string;
  lot_code: string | null;
  supplier: string | null;
  technician: string | null;
};

function grouped(rows: readonly FitRow[], nameOf: (row: FitRow) => string | null): FailureGroup[] {
  const groups = new Map<string, { fitted: number; failed: number }>();
  for (const row of rows) {
    const name = nameOf(row);
    if (name === null) continue;
    const group = groups.get(name) ?? { fitted: 0, failed: 0 };
    groups.set(name, { fitted: group.fitted + 1, failed: group.failed + row.failed });
  }
  return [...groups]
    .map(([name, { fitted, failed }]) => ({ name, fitted, failed, ratePercent: failureRatePercent(failed, fitted) }))
    .sort((a, b) => b.failed - a.failed || (b.ratePercent ?? 0) - (a.ratePercent ?? 0) || a.name.localeCompare(b.name));
}

/** The labelled pieces fitted since the day, and how many failed, four ways. */
export async function failureRates(db: D1Database, since: string): Promise<FailureRates> {
  const { results } = await db
    .prepare(
      `SELECT p.failed_at IS NOT NULL AS failed, c.name, l.lot_code,
         (SELECT s.name FROM receipt_lines rl JOIN po_lines pl ON pl.id = rl.po_line_id
            JOIN purchase_orders o ON o.id = pl.po_id JOIN suppliers s ON s.id = o.supplier_id
          WHERE rl.lot_code = l.lot_code AND pl.consumable_code = l.consumable_code LIMIT 1) AS supplier,
         t.name AS technician
       FROM pieces p JOIN stock_units u ON u.code = p.piece_code JOIN consumables c ON c.code = u.consumable_code
       LEFT JOIN stock_lots l ON l.id = u.lot_id LEFT JOIN appointments a ON a.id = p.appointment_id
       LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE p.fitted_at >= ?1 AND p.deleted_at IS NULL`,
    )
    .bind(since)
    .all<FitRow>();
  return {
    byCode: grouped(results, (row) => row.name),
    byLot: grouped(results, (row) => (row.lot_code === null ? null : `${row.name} · ${row.lot_code}`)),
    bySupplier: grouped(results, (row) => row.supplier),
    byTechnician: grouped(results, (row) => row.technician),
  };
}

export interface LotAtRisk {
  readonly placeId: Place;
  readonly place: string;
  readonly code: string;
  readonly name: string;
  readonly lotCode: string;
  readonly expiresOn: string;
  readonly quantity: number;
  readonly value: number;
  /** What to do: write off what has expired, move it to the place that lets it go fastest, or use it first. */
  readonly suggestion: "write_off" | "move" | "use_first";
  readonly moveTo: string | null;
}

/** Write off what has expired; else move it where it goes faster, if anywhere does; else use it first. */
const suggestionOf = (expired: boolean, busier: boolean): LotAtRisk["suggestion"] => {
  if (expired) return "write_off";
  return busier ? "move" : "use_first";
};

type LotRow = {
  place: string;
  lot_id: string;
  quantity: number;
  code: string;
  name: string;
  lot_code: string;
  expires_on: string;
  cost: number;
};

/**
 * Each lot in the places given (null for every place) that will not all be used before it expires at its place's pace
 * since the instant, most value first.
 */
export async function expiryRisk(
  db: D1Database,
  input: { readonly today: string; readonly since: string; readonly paceDays: number },
  within: ReadonlySet<Place> | null,
): Promise<LotAtRisk[]> {
  const [held, left] = await db.batch<LotRow | { place: string; code: string; left: number }>([
    db.prepare(
      `SELECT b.place, b.lot_id, b.quantity, l.consumable_code AS code, c.name, l.lot_code, l.expires_on,
         COALESCE(l.landed_cost_paise, c.unit_cost) AS cost
       FROM stock_lot_balances b INDEXED BY stock_lot_balances_held JOIN stock_lots l ON l.id = b.lot_id
       JOIN consumables c ON c.code = l.consumable_code
       WHERE b.quantity > 0 AND l.expires_on IS NOT NULL`,
    ),
    db
      .prepare(
        `SELECT COALESCE(place_id, technician_id, 'central') AS place, consumable_code AS code, SUM(-quantity) AS left
         FROM stock_movements INDEXED BY stock_movements_latest
         WHERE created_at >= ?1 AND quantity < 0 AND reason IN ('used', 'transferred') GROUP BY 1, 2`,
      )
      .bind(input.since),
  ]);
  const lots = ((held?.results ?? []) as LotRow[]).filter((lot) => within === null || within.has(lot.place));
  const pace = (left?.results ?? []) as { place: string; code: string; left: number }[];
  const perDay = (place: string, code: string) =>
    (pace.find((row) => row.place === place && row.code === code)?.left ?? 0) / input.paceDays;
  const names = new Map((await allPlaces(db)).map((place) => [place.id, place.name]));
  const atRisk: LotAtRisk[] = [];
  for (const [key, group] of Map.groupBy(lots, (lot) => `${lot.place}|${lot.code}`)) {
    const [place = "", code = ""] = key.split("|");
    const unused = unusedByExpiry(
      group.map((lot) => ({ lotId: lot.lot_id, quantity: lot.quantity, expiresOn: lot.expires_on })),
      perDay(place, code),
      input.today,
    );
    const busiest = pace.filter((row) => row.code === code && row.place !== place).sort((a, b) => b.left - a.left)[0];
    for (const lot of group) {
      const quantity = unused.get(lot.lot_id) ?? 0;
      if (quantity === 0) continue;
      const expired = lot.expires_on < input.today;
      const suggestion = suggestionOf(expired, busiest !== undefined);
      atRisk.push({
        placeId: place,
        place: names.get(place) ?? place,
        code,
        name: lot.name,
        lotCode: lot.lot_code,
        expiresOn: lot.expires_on,
        quantity,
        value: quantity * lot.cost,
        suggestion,
        moveTo: suggestion === "move" && busiest !== undefined ? (names.get(busiest.place) ?? busiest.place) : null,
      });
    }
  }
  return atRisk.sort((a, b) => b.value - a.value);
}

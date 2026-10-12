// Hair systems and areas in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): each piece fitted,
// with the day it falls due, its base and lot, the technician and city of its fit, the day it failed and whether its
// replacement is booked; and each area we know, by city. A piece's failure reason is the technician's own words, so it
// stays out. Records marked as tests are left out; an erased client's pieces stay, with no key.

import { indiaDate } from "../../lib/india-time.ts";
import { slugOf } from "../../lib/slug.ts";
import type { TableRows } from "../../providers/warehouse/index.ts";

interface PieceRow {
  readonly id: string;
  readonly person_id: string;
  readonly erased: number;
  readonly fitted_at: string | null;
  readonly replacement_due_at: string | null;
  readonly technician_id: string | null;
  readonly city: string | null;
  readonly base: string | null;
  readonly supplier_lot: string | null;
  readonly failed_at: string | null;
  readonly replacement_booked: number;
}

const dayOf = (at: string | null) => (at === null ? null : indiaDate(new Date(at)));

/** An area's key: its city and its name, as words of a code. */
export const areaKeyOf = (city: string, area: string) => `${slugOf(city, 40)}|${slugOf(area, 60)}`;

export async function pieceRows(db: D1Database, keys: ReadonlyMap<string, string>): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.person_id, p.erased_at IS NOT NULL AS erased, c.fitted_at, c.replacement_due_at, a.technician_id,
         a.service_city AS city, c.base, c.supplier_lot, c.failed_at, c.replacement_booked
       FROM pieces c JOIN people p ON p.id = c.person_id LEFT JOIN appointments a ON a.id = c.appointment_id
       WHERE c.deleted_at IS NULL AND p.test_record = 0`,
    )
    .all<PieceRow>();
  return {
    table: "fact_piece",
    key: ["piece_key"],
    stamped: true,
    rows: results.map((row) => ({
      piece_key: row.id,
      fitted_date: dayOf(row.fitted_at),
      due_date: dayOf(row.replacement_due_at),
      client_key: row.erased === 1 ? null : (keys.get(row.person_id) ?? null),
      technician_key: row.technician_id,
      city: row.city,
      base: row.base,
      lot: row.supplier_lot,
      failed_date: dayOf(row.failed_at),
      failure_reason: null,
      replacement_booked: row.replacement_booked === 1,
    })),
  };
}

export async function areaRows(db: D1Database): Promise<TableRows> {
  const { results } = await db
    .prepare(
      `SELECT city, area, MAX(served) AS served FROM serviceable_pincodes
       WHERE area IS NOT NULL AND city IS NOT NULL GROUP BY city, area`,
    )
    .all<{ city: string; area: string; served: number }>();
  return {
    table: "dim_area",
    key: ["area_key"],
    stamped: false,
    rows: results.map((row) => ({
      area_key: areaKeyOf(row.city, row.area),
      area: row.area,
      city: row.city,
      served: row.served === 1,
    })),
  };
}

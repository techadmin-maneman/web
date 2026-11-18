// The hair system a client wears now, for Home and the profile (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md):
// its package, the day it was fitted, how many months it is worn, the day it falls due, and the first day its
// replacement may be booked on. Read from the piece in wear and the package it was fitted under.

import { indiaDate } from "../../lib/india-time.ts";
import { replacementOpensOn } from "../../policy/next-visit.ts";

export interface WornHairSystem {
  /** The package's code, and its name as clients read it. */
  readonly package: string;
  readonly name: string;
  /** India's day it was fitted. */
  readonly fitted_on: string;
  /** How many months a hair system of its package is worn. */
  readonly replace_after_months: number;
  /** India's day it falls due. */
  readonly due_on: string;
  /** The first day its replacement may be booked on: the first day of the month it falls due. */
  readonly replacement_opens_on: string;
}

/** The piece in wear, the package it was fitted under (the visit's, else the client's), and that package's figures. */
const WORN = `SELECT pc.fitted_at, pc.replacement_due_at, k.code AS package, f.name, k.replace_after_months
  FROM pieces pc
  JOIN people p ON p.id = pc.person_id
  LEFT JOIN appointments a ON a.id = pc.appointment_id AND a.type IN ('first_fit', 'replacement')
  JOIN packages k ON k.code = COALESCE(a.tier, p.package)
  JOIN services f ON f.kind = 'first_fit' AND f.tier = k.code
  WHERE pc.person_id = ?1 AND pc.deleted_at IS NULL AND pc.failed_at IS NULL AND pc.replaced_at IS NULL
    AND pc.fitted_at IS NOT NULL AND pc.replacement_due_at IS NOT NULL
  ORDER BY pc.fitted_at DESC LIMIT 1`;

interface WornRow {
  readonly fitted_at: string;
  readonly replacement_due_at: string;
  readonly package: string;
  readonly name: string;
  readonly replace_after_months: number;
}

/** A stored day or instant as India's day. */
const dayOf = (stored: string): string => (stored.length > 10 ? indiaDate(new Date(stored)) : stored);

/** The hair system the client wears, or null for none in wear under a package. */
export async function wornHairSystem(db: D1Database, personId: string): Promise<WornHairSystem | null> {
  const row = await db.prepare(WORN).bind(personId).first<WornRow>();
  if (row === null) return null;
  const dueOn = dayOf(row.replacement_due_at);
  return {
    package: row.package,
    name: row.name,
    fitted_on: dayOf(row.fitted_at),
    replace_after_months: row.replace_after_months,
    due_on: dueOn,
    replacement_opens_on: replacementOpensOn(dueOn),
  };
}

// Packages (docs/decisions/0211-packages.md; src/policy/packages.ts): what a client chooses and stays on. A package is
// a row of its own figures, how often its service visit falls due and how long its hair system is worn, and three
// services under its code: its first fit, its service visit and its replacement, each timed and priced as any
// service is (./services.ts). Its name, description, order and retirement are its first fit's, which clients choose
// it by; its hair systems name it as their product (src/domain/inventory/hair-systems.ts). Ops change them in the
// console (./package-changes.ts).

import { STANDARD_TIER } from "../../config/visit-types.ts";
import { REPLACE_AFTER_MONTHS, SERVICE_EVERY_DAYS } from "../../policy/packages.ts";

/** A package with each of its parts' figures. */
export interface Package {
  /** The code its services share as their tier; never changed. */
  readonly code: string;
  readonly name: string;
  /** The line clients read under its name as they choose; null until ops write one. */
  readonly description: string | null;
  readonly sort: number;
  /** India's date from which it is no longer sold; null while it is. */
  readonly retired_date: string | null;
  readonly first_fit_minutes: number;
  readonly service_minutes: number;
  readonly service_every_days: number;
  readonly replacement_minutes: number;
  readonly replace_after_months: number;
  readonly updated_by: string;
  readonly updated_at: string;
}

const PACKAGES = `SELECT p.code, f.name, f.description, f.sort, f.retired_date, f.minutes AS first_fit_minutes,
    s.minutes AS service_minutes, p.service_every_days, r.minutes AS replacement_minutes, p.replace_after_months,
    p.updated_by, p.updated_at
  FROM packages p
  JOIN services f ON f.kind = 'first_fit' AND f.tier = p.code
  JOIN services s ON s.kind = 'service' AND s.tier = p.code
  JOIN services r ON r.kind = 'replacement' AND r.tier = p.code`;

/** Every package, sold or retired, in the order ops gave them. */
export async function allPackages(db: D1Database): Promise<Package[]> {
  const { results } = await db.prepare(`${PACKAGES} ORDER BY f.sort, f.name COLLATE NOCASE`).all<Package>();
  return results;
}

/** One package by its code; null for none. */
export function packageCoded(db: D1Database, code: string): Promise<Package | null> {
  return db.prepare(`${PACKAGES} WHERE p.code = ?1`).bind(code).first<Package>();
}

/**
 * How often a client's service visit falls due, in SQL, for the package `onPackage` names, their people row's
 * package: its own, else the standard package's, else the days a new package starts with. Each is read by its key.
 */
export const everyDaysSql = (onPackage: string): string =>
  `COALESCE((SELECT k.service_every_days FROM packages k WHERE k.code = ${onPackage}),
    (SELECT k.service_every_days FROM packages k WHERE k.code = '${STANDARD_TIER}'), ${String(SERVICE_EVERY_DAYS.start)})`;

/** The fewest and the most days any package's service visit falls due after, for reads across every client. */
export async function cadenceRange(db: D1Database): Promise<{ readonly least: number; readonly most: number }> {
  const row = await db
    .prepare("SELECT MIN(service_every_days) AS least, MAX(service_every_days) AS most FROM packages")
    .first<{ least: number | null; most: number | null }>();
  return { least: row?.least ?? SERVICE_EVERY_DAYS.start, most: row?.most ?? SERVICE_EVERY_DAYS.start };
}

/**
 * How many months a hair system fitted on a visit is worn before its replacement falls due: the package the visit is
 * a first fit or replacement of, else the client's, else the standard package's, else the months a new one starts with.
 */
export async function replaceAfterMonthsFor(
  db: D1Database,
  visit: { readonly id: string; readonly personId: string },
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(
         (SELECT k.replace_after_months FROM appointments a JOIN packages k ON k.code = a.tier
           WHERE a.id = ?1 AND a.type IN ('first_fit', 'replacement')),
         (SELECT k.replace_after_months FROM people p JOIN packages k ON k.code = p.package WHERE p.id = ?2),
         (SELECT replace_after_months FROM packages WHERE code = '${STANDARD_TIER}')) AS months`,
    )
    .bind(visit.id, visit.personId)
    .first<{ months: number | null }>();
  return row?.months ?? REPLACE_AFTER_MONTHS.start;
}

/**
 * The boxes a horizon shorter than a package's service cadence conflicts with, for the booking days' input: the
 * horizon, then the cadence it must reach. Null for any other input, and for a horizon every package's reaches.
 */
export async function packagesPastHorizon(
  db: D1Database,
  setting: string,
  value: number | Readonly<Record<string, number | string>>,
): Promise<readonly [string, string] | null> {
  if (setting !== "booking_days" || typeof value !== "object") return null;
  const horizon = value.horizon;
  if (typeof horizon !== "number") return null;
  return (await cadenceRange(db)).most > horizon ? ["booking_days.horizon", "packages.service_every_days"] : null;
}

// Packages in the console (docs/decisions/0211-packages.md; ./packages.ts): each package's hair systems as its page
// lists them, and what ops change: one added, changed a box at a time, put in order, or deleted while nothing was
// sold under it. Every change is written in one batch with
// its audit entry (ADR 0031). Retiring a package is retiring its first fit (./services.ts): it is no longer sold, and
// its clients keep their service visits and replacements.

import { VISIT_BLOCKS } from "../../config/scheduling.ts";
import { failedUniqueOn } from "../../lib/d1-errors.ts";
import {
  PACKAGE_KINDS,
  REPLACE_AFTER_MONTHS,
  SERVICE_EVERY_DAYS,
  serviceNameOf,
  type PackageKind,
} from "../../policy/packages.ts";
import { isServiceDescription, PRICE_TIER, SERVICE_NAME, tierCodeOf } from "../../policy/services.ts";
import { isServiceLength } from "../../policy/visit-length.ts";
import { auditStatement, auditStatementWhen, opsEntry, type Written } from "../platform/audit.ts";
import { allPackages, packageCoded, type Package } from "./packages.ts";
import { productNamedSql } from "../clients/hair-profiles.ts";
import { SPEC_COLUMNS, specOf, type HairSystemSpec, type SpecRow } from "../inventory/hair-systems.ts";
import { renamedHairSystems } from "../inventory/hair-system-names.ts";

/** Why a change to a package was refused: the box it names, where there is one. */
export type PackageRefusal =
  | { readonly refused: "invalid"; readonly field: PackageField | "code" }
  /** Another service already has one of its names, or another package its code. */
  | { readonly refused: "taken"; readonly field: "name" | "code" }
  /** Something was sold under it, or a client is on it: it can be retired, not deleted. */
  | { readonly refused: "in_use" }
  | { readonly refused: "not_found" };

/** What ops change of a package, a box at a time. */
export interface PackageChanges {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly first_fit_minutes?: number | undefined;
  readonly service_minutes?: number | undefined;
  readonly service_every_days?: number | undefined;
  readonly replacement_minutes?: number | undefined;
  readonly replace_after_months?: number | undefined;
}
type PackageField = keyof PackageChanges;

const MINUTES_OF: Readonly<Record<PackageKind, "first_fit_minutes" | "service_minutes" | "replacement_minutes">> = {
  first_fit: "first_fit_minutes",
  service: "service_minutes",
  replacement: "replacement_minutes",
};

const within = (value: number, bounds: { readonly min: number; readonly max: number }) =>
  Number.isInteger(value) && value >= bounds.min && value <= bounds.max;

/** The first box of these that will not hold, or null; a service visit due no further on than clients book ahead. */
function invalidField(changes: PackageChanges, horizon: number = SERVICE_EVERY_DAYS.max): PackageField | null {
  if (changes.name !== undefined && !SERVICE_NAME.test(serviceNameOf(changes.name.trim(), "service"))) return "name";
  if (changes.description !== undefined && !isServiceDescription(changes.description.trim())) return "description";
  for (const kind of PACKAGE_KINDS) {
    const minutes = changes[MINUTES_OF[kind]];
    if (minutes !== undefined && !isServiceLength(minutes)) return MINUTES_OF[kind];
  }
  const every = { min: SERVICE_EVERY_DAYS.min, max: Math.min(SERVICE_EVERY_DAYS.max, horizon) };
  if (changes.service_every_days !== undefined && !within(changes.service_every_days, every)) {
    return "service_every_days";
  }
  if (changes.replace_after_months !== undefined && !within(changes.replace_after_months, REPLACE_AFTER_MONTHS)) {
    return "replace_after_months";
  }
  return null;
}

/** Whether any service other than this package's has one of the names a package of this name gives its services. */
async function nameTaken(db: D1Database, name: string, code: string | null): Promise<boolean> {
  const names = PACKAGE_KINDS.map((kind) => serviceNameOf(name, kind));
  const found = await db
    .prepare(
      `SELECT 1 FROM services WHERE name IN (?1, ?2, ?3) COLLATE NOCASE AND NOT (tier IS ?4 AND kind IN
         ('first_fit', 'service', 'replacement')) LIMIT 1`,
    )
    .bind(...names, code)
    .first();
  return found !== null;
}

const subjectOf = (code: string) => ({ kind: "package", id: code });

/**
 * Adds a package, last in the order, with its three services named from it and timed as their kinds are, its
 * service visit due every month and its hair system worn six. Clients see it once its hair systems and its service
 * visit are priced.
 */
export async function addPackage(
  db: D1Database,
  input: Written & { readonly name: string; readonly code?: string | undefined },
): Promise<Package | PackageRefusal> {
  const name = input.name.trim();
  if (invalidField({ name }) !== null) return { refused: "invalid", field: "name" };
  const code = input.code ?? tierCodeOf(name);
  if (code === null || !PRICE_TIER.test(code)) return { refused: "invalid", field: "code" };
  if (await nameTaken(db, name, null)) return { refused: "taken", field: "name" };
  const held = await db
    .prepare(
      "SELECT 1 WHERE EXISTS (SELECT 1 FROM packages WHERE code = ?1) OR EXISTS (SELECT 1 FROM services WHERE tier = ?1 AND kind != 'consultation')",
    )
    .bind(code)
    .first();
  if (held !== null) return { refused: "taken", field: "code" };

  const at = input.now.toISOString();
  const service = (kind: PackageKind) =>
    db
      .prepare(
        `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort), -1) + 1 FROM services WHERE kind = 'first_fit'), ?5, ?6)`,
      )
      .bind(kind, code, serviceNameOf(name, kind), VISIT_BLOCKS[kind].minutes, input.actor.id, at);
  try {
    await db.batch([
      auditStatement(db, opsEntry(input, "package.add", subjectOf(code)), input.now),
      db
        .prepare(
          `INSERT INTO packages (code, service_every_days, replace_after_months, updated_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(code, SERVICE_EVERY_DAYS.start, REPLACE_AFTER_MONTHS.start, input.actor.id, at),
      ...PACKAGE_KINDS.map(service),
    ]);
  } catch (error) {
    // Another add took a name or the code between the look and the write.
    if (failedUniqueOn(error, "services") || failedUniqueOn(error, "packages"))
      return { refused: "taken", field: "name" };
    throw error;
  }
  return (await packageCoded(db, code)) ?? { refused: "not_found" };
}

/** The statements that write these changes to a package's row and its services. */
function changeStatements(db: D1Database, code: string, changes: PackageChanges, written: Written) {
  const at = written.now.toISOString();
  const service = (kind: PackageKind, column: "name" | "description" | "minutes", value: string | number | null) =>
    db
      .prepare(`UPDATE services SET ${column} = ?3, updated_by = ?4, updated_at = ?5 WHERE kind = ?1 AND tier = ?2`)
      .bind(kind, code, value, written.actor.id, at);
  const statements: D1PreparedStatement[] = [];
  const name = changes.name?.trim();
  if (name !== undefined) {
    // Its hair systems first: they read the first fit's name before it changes.
    statements.push(renamedHairSystems(db, code, serviceNameOf(name, "first_fit"), written.now));
    statements.push(...PACKAGE_KINDS.map((kind) => service(kind, "name", serviceNameOf(name, kind))));
  }
  if (changes.description !== undefined) {
    const line = changes.description.trim();
    statements.push(service("first_fit", "description", line === "" ? null : line));
  }
  for (const kind of PACKAGE_KINDS) {
    const minutes = changes[MINUTES_OF[kind]];
    if (minutes !== undefined) statements.push(service(kind, "minutes", minutes));
  }
  statements.push(
    db
      .prepare(
        `UPDATE packages SET service_every_days = COALESCE(?2, service_every_days),
           replace_after_months = COALESCE(?3, replace_after_months), updated_by = ?4, updated_at = ?5
         WHERE code = ?1`,
      )
      .bind(code, changes.service_every_days ?? null, changes.replace_after_months ?? null, written.actor.id, at),
  );
  return statements;
}

/** What changed, as the audit entry holds it: each box's figure, and that the name or description did. */
function changedDetail(was: Package, changes: PackageChanges): Record<string, string | number | boolean> {
  const detail: Record<string, string | number | boolean> = {};
  if (changes.name !== undefined && changes.name.trim() !== was.name) detail.renamed = true;
  if (changes.description !== undefined && (changes.description.trim() || null) !== was.description) {
    detail.described = true;
  }
  const figures = [
    "first_fit_minutes",
    "service_minutes",
    "service_every_days",
    "replacement_minutes",
    "replace_after_months",
  ] as const;
  for (const field of figures) {
    const to = changes[field];
    if (to !== undefined && to !== was[field]) detail[field] = to;
  }
  return detail;
}

/**
 * Changes what ops set of a package: its name, which its three services are renamed by, the line clients read, how
 * long each part takes, how often its service visit falls due and how long its hair system is worn. A visit already
 * booked keeps the length it was booked for; a piece already fitted, the day it falls due.
 */
export async function changePackage(
  db: D1Database,
  input: Written & {
    readonly code: string;
    readonly changes: PackageChanges;
    /** How far ahead clients may book, in days, which a service visit is due no further on than. */
    readonly horizon: number;
  },
): Promise<Package | PackageRefusal> {
  const { code, changes } = input;
  const was = await packageCoded(db, code);
  if (was === null) return { refused: "not_found" };
  const invalid = invalidField(changes, input.horizon);
  if (invalid !== null) return { refused: "invalid", field: invalid };
  if (changes.name !== undefined && (await nameTaken(db, changes.name.trim(), code))) {
    return { refused: "taken", field: "name" };
  }
  const detail = changedDetail(was, changes);
  if (Object.keys(detail).length === 0) return was;
  try {
    await db.batch([
      auditStatement(db, opsEntry(input, "package.change", subjectOf(code), detail), input.now),
      ...changeStatements(db, code, changes, input),
    ]);
  } catch (error) {
    if (failedUniqueOn(error, "services")) return { refused: "taken", field: "name" };
    throw error;
  }
  return (await packageCoded(db, code)) ?? { refused: "not_found" };
}

/** Whether anything was sold under a package, a client is on it or was recommended it, or a hair system names it. */
const IN_USE = `(EXISTS (SELECT 1 FROM appointments WHERE tier = ?1 AND type IN ('first_fit', 'service', 'replacement'))
  OR EXISTS (SELECT 1 FROM slot_holds WHERE tier = ?1 AND type IN ('first_fit', 'service', 'replacement'))
  OR EXISTS (SELECT 1 FROM people WHERE package = ?1)
  OR ${productNamedSql("?1")}
  OR EXISTS (SELECT 1 FROM hair_systems WHERE product = ?1))`;

/**
 * Deletes a package added by mistake, with its services, their prices, costs and expected use, while nothing was
 * ever sold under it, no client is on it and no hair system names it. One that has been sold is retired instead.
 */
export async function deletePackage(
  db: D1Database,
  input: Written & { readonly code: string },
): Promise<"deleted" | PackageRefusal> {
  const { code } = input;
  if ((await packageCoded(db, code)) === null) return { refused: "not_found" };
  if ((await db.prepare(`SELECT 1 WHERE ${IN_USE}`).bind(code).first()) !== null) return { refused: "in_use" };
  const kinds = "('first_fit', 'service', 'replacement')";
  const unused = (statement: string) => db.prepare(`${statement} AND NOT ${IN_USE}`).bind(code);
  await db.batch([
    auditStatementWhen(db, opsEntry(input, "package.delete", subjectOf(code)), input.now, {
      sql: `NOT ${IN_USE.replaceAll("?1", "?10")}`,
      binds: [code],
    }),
    unused(`DELETE FROM price_book WHERE item IN ${kinds} AND tier = ?1`),
    unused(`DELETE FROM city_prices WHERE item IN ${kinds} AND tier = ?1`),
    unused(`DELETE FROM standard_costs WHERE item IN ${kinds} AND tier = ?1`),
    unused(`DELETE FROM consumable_usage WHERE visit_type IN ${kinds} AND tier = ?1`),
    unused(`DELETE FROM services WHERE kind IN ${kinds} AND tier = ?1`),
    unused("DELETE FROM packages WHERE code = ?1"),
  ]);
  return (await packageCoded(db, code)) === null ? "deleted" : { refused: "in_use" };
}

/** The packages in a new order, every one of them, each once: their three services each take the place. */
export async function reorderPackages(
  db: D1Database,
  input: Written & { readonly codes: readonly string[] },
): Promise<Package[] | PackageRefusal> {
  const { codes } = input;
  const held = (await allPackages(db)).map((each) => each.code);
  const same = [...codes].sort().join(",") === [...held].sort().join(",");
  if (!same || new Set(codes).size !== codes.length) return { refused: "invalid", field: "code" };
  const at = input.now.toISOString();
  await db.batch([
    auditStatement(
      db,
      opsEntry(input, "package.reorder", { kind: "package", id: "order" }, { order: codes.join(",") }),
      input.now,
    ),
    ...codes.map((code, index) =>
      db
        .prepare(
          `UPDATE services SET sort = ?2, updated_by = ?3, updated_at = ?4
           WHERE tier = ?1 AND kind IN ('first_fit', 'service', 'replacement') AND sort IS NOT ?2`,
        )
        .bind(code, index, input.actor.id, at),
    ),
  ]);
  return allPackages(db);
}

/** The packages something was sold under, a client is on or was recommended, or a hair system names. */
export async function packagesInUse(db: D1Database): Promise<Set<string>> {
  const { results } = await db
    .prepare(`SELECT p.code FROM packages p WHERE ${IN_USE.replaceAll("?1", "p.code")}`)
    .all<{ code: string }>();
  return new Set(results.map((row) => row.code));
}

/** A hair system as its package's page lists it: its spec, name, cost, and whether it is retired. */
export interface HairSystemOfPackage extends HairSystemSpec {
  readonly code: string;
  readonly name: string;
  /** What one costs us, in paise. */
  readonly unitCost: number;
  readonly retiredDate: string | null;
  /** Stock of it has moved or a job used it: it may be retired, never deleted. */
  readonly used: boolean;
}

/** Every hair system, each with its package, name, cost and retirement, by name. */
export async function hairSystemsOfPackages(db: D1Database): Promise<HairSystemOfPackage[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SPEC_COLUMNS}, c.name, c.unit_cost, c.retired_date,
         (EXISTS (SELECT 1 FROM stock_movements m WHERE m.consumable_code = h.code)
           OR EXISTS (SELECT 1 FROM stock_balances b WHERE b.consumable_code = h.code)
           OR EXISTS (SELECT 1 FROM consumables_used u WHERE u.consumable_code = h.code)) AS used
       FROM hair_systems h JOIN consumables c ON c.code = h.code
       ORDER BY c.name COLLATE NOCASE`,
    )
    .all<SpecRow & { name: string; unit_cost: number; retired_date: string | null; used: number }>();
  return results.map((row) => ({
    ...specOf(row),
    code: row.code,
    name: row.name,
    unitCost: row.unit_cost,
    retiredDate: row.retired_date,
    used: row.used === 1,
  }));
}

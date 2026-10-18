// The package a client is on (docs/decisions/0211-packages.md): the one they last booked a first fit or a replacement
// of, or ops put them on, kept on their people row. Before they book either, their consultation's recommendation, in
// their hair profile, stands in. Their service visits, replacements and when each falls due follow it.

import { auditStatement, opsEntry, type Written } from "../platform/audit.ts";
import { recommendedProductSql } from "./hair-profiles.ts";

/** The package a client is on, or the one their latest hair profile recommends; null for neither. */
export async function clientPackage(db: D1Database, personId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT COALESCE(p.package, ${recommendedProductSql("p.id")}) AS package FROM people p WHERE p.id = ?1`)
    .bind(personId)
    .first<{ package: string | null }>();
  return row?.package ?? null;
}

/** The package a service visit or a replacement naming no tier is for: the client's; null for any other booking. */
export const packageWanted = (
  db: D1Database,
  wanted: { readonly kind: string; readonly tier?: string | undefined; readonly personId: string },
): Promise<string | null> =>
  (wanted.kind === "service" || wanted.kind === "replacement") && wanted.tier === undefined
    ? clientPackage(db, wanted.personId)
    : Promise.resolve(null);

/**
 * Puts a client on a package, as a first fit or a replacement booked under it does (src/domain/booking/bookings.ts):
 * the statement to write with the booking. Any other kind of visit leaves it as it is.
 */
export function onPackageBooked(
  db: D1Database,
  booked: { readonly personId: string; readonly type: string; readonly tier: string },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE people SET package = ?2 WHERE id = ?1 AND ?3 IN ('first_fit', 'replacement')
         AND package IS NOT ?2 AND EXISTS (SELECT 1 FROM packages WHERE code = ?2)`,
    )
    .bind(booked.personId, booked.tier, booked.type);
}

/** Puts a client on another package, from the console, with its audit entry. "not_found" for no such client or package. */
export async function setClientPackage(
  db: D1Database,
  input: Written & { readonly personId: string; readonly code: string },
): Promise<"set" | "not_found"> {
  const found = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL) AS person,
         EXISTS (SELECT 1 FROM packages WHERE code = ?2) AS package`,
    )
    .bind(input.personId, input.code)
    .first<{ person: number; package: number }>();
  if (found?.person !== 1 || found.package !== 1) return "not_found";
  await db.batch([
    auditStatement(
      db,
      opsEntry(input, "client.package", { kind: "person", id: input.personId }, { package: input.code }),
      input.now,
    ),
    db.prepare("UPDATE people SET package = ?2 WHERE id = ?1").bind(input.personId, input.code),
  ]);
  return "set";
}

/** A client's package as their record shows it, with the packages they may be put on: those sold today, and theirs. */
export async function packageOfRecord(
  db: D1Database,
  personId: string,
  today: string,
): Promise<{
  readonly current: { readonly code: string; readonly name: string; readonly chosen: boolean } | null;
  readonly choices: { readonly code: string; readonly name: string }[];
}> {
  const [row, { results }] = await Promise.all([
    db
      .prepare(
        `SELECT p.package AS chosen, ${recommendedProductSql("p.id")} AS recommended FROM people p WHERE p.id = ?1`,
      )
      .bind(personId)
      .first<{ chosen: string | null; recommended: string | null }>(),
    db
      .prepare(
        `SELECT k.code, f.name, f.retired_date FROM packages k
         JOIN services f ON f.kind = 'first_fit' AND f.tier = k.code ORDER BY f.sort, f.name COLLATE NOCASE`,
      )
      .all<{ code: string; name: string; retired_date: string | null }>(),
  ]);
  const code = row?.chosen ?? row?.recommended ?? null;
  const named = results.find((each) => each.code === code);
  return {
    current:
      named === undefined ? null : { code: named.code, name: named.name, chosen: (row?.chosen ?? null) !== null },
    choices: results
      .filter((each) => each.code === code || each.retired_date === null || each.retired_date > today)
      .map((each) => ({ code: each.code, name: each.name })),
  };
}

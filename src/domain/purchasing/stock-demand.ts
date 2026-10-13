// What the next four weeks will use (docs/decisions/0160-demand-and-opening-counts.md): for each stock code and city,
// what the visits booked in them are expected to use, by each service's expected use, and the hair system each fit
// booked is made to, by the client's hair profile; beside what the city's places hold. A fit whose hair system no place
// in its city holds, or whose client has no profile to match, is at risk: it is shown, and nothing is blocked.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import { latestFits, type FitToMatch } from "../clients/hair-profiles.ts";
import { hairSystemSpecs, matchingCode, type HairSystemSpec } from "../inventory/hair-systems.ts";

/** One stock code's expected use in one city over the weeks ahead, beside what the city holds. */
export interface Demand {
  readonly code: string;
  /** Null for visits whose city cannot be found. */
  readonly city: string | null;
  readonly expected: number;
  readonly held: number;
}

/** A fit booked ahead whose hair system is not in its city, or cannot be named. */
export interface AtRisk {
  readonly appointmentId: string;
  readonly date: string;
  readonly city: string | null;
  /** The stock code it needs; null when the client has no profile to match one by. */
  readonly code: string | null;
}

/** The visits booked ahead, `a`, with their city: the technician's, or the address's. */
const BOOKED_AHEAD = `LEFT JOIN technicians t ON t.id = a.technician_id
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
  WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.status IN ('scheduled', 'dispatched')
    AND a.deleted_at IS NULL`;

const CITY = "COALESCE(t.city, sp.city)";

interface FitRow {
  readonly id: string;
  readonly person_id: string | null;
  readonly type: string;
  readonly tier: string | null;
  readonly window_start: string;
  readonly city: string | null;
}

/** The stock code made to a fit's spec: the product it was booked as on a first fit, the profile's on a replacement. */
function codeFor(
  fit: FitRow,
  profile: FitToMatch | undefined,
  specs: ReadonlyMap<string, HairSystemSpec>,
): string | null {
  if (profile === undefined) return null;
  const product = fit.type === "first_fit" ? (fit.tier ?? "standard") : profile.product;
  return matchingCode(specs, { ...profile, product });
}

/**
 * What each city's places hold of each stock code, a kit in its technician's city: of every code, or of those named,
 * read by their keys.
 */
async function heldByCity(db: D1Database, codes: readonly string[] | null): Promise<Map<string, number>> {
  const read =
    codes === null
      ? db.prepare(
          `SELECT b.consumable_code AS code, COALESCE(p.city, t.city) AS city, SUM(b.quantity) AS held
           FROM stock_balances b JOIN stock_places p ON p.id = b.place LEFT JOIN technicians t ON t.id = p.technician_id
           WHERE b.quantity > 0 GROUP BY 1, 2`,
        )
      : db
          .prepare(
            `SELECT b.consumable_code AS code, COALESCE(p.city, t.city) AS city, SUM(b.quantity) AS held
             FROM stock_balances b JOIN stock_places p ON p.id = b.place LEFT JOIN technicians t ON t.id = p.technician_id
             WHERE b.consumable_code IN (SELECT value FROM json_each(?1)) AND b.quantity > 0 GROUP BY 1, 2`,
          )
          .bind(JSON.stringify(codes));
  const { results } = await read.all<{ code: string; city: string | null; held: number }>();
  return new Map(results.map((row) => [`${row.code}|${row.city ?? ""}`, row.held]));
}

/** The first fits and replacements booked from `from` to `to`, in their order, with their city. */
const fitsStatement = (db: D1Database, from: string, to: string) =>
  db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, ${CITY} AS city FROM appointments a ${BOOKED_AHEAD}
         AND a.type IN ('first_fit', 'replacement') ORDER BY a.window_start`,
    )
    .bind(from, to);

/** Each fit with the stock code its client's profile matches; null where it matches none. */
async function codedFits(
  db: D1Database,
  fits: readonly FitRow[],
): Promise<{ readonly fit: FitRow; readonly code: string | null }[]> {
  if (fits.length === 0) return [];
  const profiles = await latestFits(
    db,
    fits.flatMap((fit) => fit.person_id ?? []),
  );
  const specs = await hairSystemSpecs(db);
  return fits.map((fit) => ({
    fit,
    code: codeFor(fit, fit.person_id === null ? undefined : profiles.get(fit.person_id), specs),
  }));
}

/** The fits at risk, in order: no code matched, or more fits of it in the city by then than the city holds. */
function risksOf(coded: readonly { fit: FitRow; code: string | null }[], held: ReadonlyMap<string, number>): AtRisk[] {
  const needed = new Map<string, number>();
  const atRisk: AtRisk[] = [];
  for (const { fit, code } of coded) {
    const key = `${code ?? ""}|${fit.city ?? ""}`;
    if (code !== null) needed.set(key, (needed.get(key) ?? 0) + 1);
    if (code === null || (held.get(key) ?? 0) < (needed.get(key) ?? 0)) {
      atRisk.push({ appointmentId: fit.id, date: fit.window_start, city: fit.city, code });
    }
  }
  return atRisk;
}

/** The days ahead from `today` that ops read demand over (`stock_watch`), as the bounds of its booked visits. */
const weeksAhead = (today: string, days: number) => ({
  from: indiaInstant(today, "00:00").toISOString(),
  to: indiaInstant(addDays(today, days), "00:00").toISOString(),
});

/** The fits at risk in the days ahead from `today`, reading only the stock of the codes they need. */
export async function fitsAtRisk(db: D1Database, today: string, days: number): Promise<AtRisk[]> {
  const { from, to } = weeksAhead(today, days);
  const { results } = await fitsStatement(db, from, to).all<FitRow>();
  const coded = await codedFits(db, results);
  const codes = [...new Set(coded.flatMap((each) => each.code ?? []))];
  return risksOf(coded, await heldByCity(db, codes));
}

/** The days ahead from `today`: every stock code's expected use by city, and the fits at risk. */
export async function stockDemand(
  db: D1Database,
  today: string,
  days: number,
): Promise<{ readonly demand: Demand[]; readonly atRisk: AtRisk[] }> {
  const { from, to } = weeksAhead(today, days);
  const [used, fits] = await db.batch<{ code: string; city: string | null; expected: number } | FitRow>([
    db
      .prepare(
        `SELECT u.consumable_code AS code, ${CITY} AS city, SUM(u.quantity) AS expected
         FROM appointments a
         JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = COALESCE(a.tier, 'standard')
         ${BOOKED_AHEAD}
         GROUP BY 1, 2`,
      )
      .bind(from, to),
    fitsStatement(db, from, to),
  ]);
  const coded = await codedFits(db, (fits?.results ?? []) as FitRow[]);
  const held = await heldByCity(db, null);
  const expected = new Map<string, number>();
  for (const row of (used?.results ?? []) as { code: string; city: string | null; expected: number }[]) {
    expected.set(`${row.code}|${row.city ?? ""}`, row.expected);
  }
  for (const { fit, code } of coded) {
    const key = `${code ?? ""}|${fit.city ?? ""}`;
    if (code !== null) expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const atRisk = risksOf(coded, held);
  const demand = [...expected].map(([key, quantity]): Demand => {
    const [code = "", city = ""] = key.split("|");
    return { code, city: city === "" ? null : city, expected: quantity, held: held.get(key) ?? 0 };
  });
  return {
    demand: demand.sort((a, b) => a.code.localeCompare(b.code) || (a.city ?? "").localeCompare(b.city ?? "")),
    atRisk,
  };
}

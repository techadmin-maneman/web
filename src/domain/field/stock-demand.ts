// What the next four weeks will use (docs/decisions/0160-demand-and-opening-counts.md): for each stock code and city,
// what the visits booked in them are expected to use, by each service's expected use, and the hair system each fit
// booked is made to, by the client's hair profile; beside what the city's places hold. A fit whose hair system no place
// in its city holds, or whose client has no profile to match, is at risk: it is shown, and nothing is blocked.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import { DEMAND_DAYS } from "../../policy/stock.ts";
import { latestFits, type FitToMatch } from "../clients/hair-profiles.ts";
import { hairSystemSpecs, type HairSystemSpec } from "./hair-systems.ts";

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
  for (const [code, spec] of specs) {
    if (
      spec.product === product &&
      spec.baseWidthIn === profile.base_width_in &&
      spec.baseLengthIn === profile.base_length_in &&
      spec.colour === profile.colour &&
      spec.greyPercent === profile.grey_percent &&
      spec.densityPercent === profile.density_percent
    ) {
      return code;
    }
  }
  return null;
}

/** What each city's places hold of each stock code, a kit in its technician's city. */
async function heldByCity(db: D1Database): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT b.consumable_code AS code, COALESCE(p.city, t.city) AS city, SUM(b.quantity) AS held
       FROM stock_balances b
       JOIN stock_places p ON p.id = b.place
       LEFT JOIN technicians t ON t.id = p.technician_id
       WHERE b.quantity > 0 GROUP BY 1, 2`,
    )
    .all<{ code: string; city: string | null; held: number }>();
  return new Map(results.map((row) => [`${row.code}|${row.city ?? ""}`, row.held]));
}

/** The weeks ahead from `today`: every stock code's expected use by city, and the fits at risk. */
export async function stockDemand(
  db: D1Database,
  today: string,
): Promise<{ readonly demand: Demand[]; readonly atRisk: AtRisk[] }> {
  const from = indiaInstant(today, "00:00").toISOString();
  const to = indiaInstant(addDays(today, DEMAND_DAYS), "00:00").toISOString();
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
    db
      .prepare(
        `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, ${CITY} AS city FROM appointments a ${BOOKED_AHEAD}
           AND a.type IN ('first_fit', 'replacement') ORDER BY a.window_start`,
      )
      .bind(from, to),
  ]);
  const fitRows = (fits?.results ?? []) as FitRow[];
  const profiles = await latestFits(
    db,
    fitRows.flatMap((fit) => fit.person_id ?? []),
  );
  const specs = await hairSystemSpecs(db);
  const held = await heldByCity(db);

  const expected = new Map<string, number>();
  for (const row of (used?.results ?? []) as { code: string; city: string | null; expected: number }[]) {
    expected.set(`${row.code}|${row.city ?? ""}`, row.expected);
  }
  const atRisk: AtRisk[] = [];
  for (const fit of fitRows) {
    const code = codeFor(fit, fit.person_id === null ? undefined : profiles.get(fit.person_id), specs);
    const key = `${code ?? ""}|${fit.city ?? ""}`;
    if (code !== null) expected.set(key, (expected.get(key) ?? 0) + 1);
    if (code === null || (held.get(key) ?? 0) < (expected.get(key) ?? 0)) {
      atRisk.push({ appointmentId: fit.id, date: fit.window_start, city: fit.city, code });
    }
  }
  const demand = [...expected].map(([key, quantity]): Demand => {
    const [code = "", city = ""] = key.split("|");
    return { code, city: city === "" ? null : city, expected: quantity, held: held.get(key) ?? 0 };
  });
  return {
    demand: demand.sort((a, b) => a.code.localeCompare(b.code) || (a.city ?? "").localeCompare(b.city ?? "")),
    atRisk,
  };
}

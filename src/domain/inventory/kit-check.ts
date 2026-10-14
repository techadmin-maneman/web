// Tomorrow's kits (docs/decisions/0181-tomorrows-kits.md): each evening, each technician's kit against their visits
// tomorrow, each visit's consumables by its service's expected use and each fit's hair system made to its client. What
// a kit is short of becomes a top-up on the supply plan, from its city's stockroom or else the warehouse, which arrives
// once the technician scans it in; and ops are told, once a kit a day.
//
// A one visit's client is seldom known before the visit, so its kit carries the one-visit range
// (docs/decisions/0184-the-one-visit-range.md): one of each of the hair systems its city's latest forecast expects most.
// On the evening ops set, the check looks a week ahead for consumables (./kit-week.ts). What is on its way to a kit
// counts as held, so a top-up approved is not proposed again in the next hour.

import { addDays, indiaDate, indiaHour, indiaInstant, weekdayOf } from "../../lib/india-time.ts";
import { latestFits } from "../clients/hair-profiles.ts";
import type { KitCheck } from "../../policy/kit-check.ts";
import type { AlertOnce } from "../platform/alerts.ts";
import { hairSystemSpecs, matchingCode } from "./hair-systems.ts";
import { addTheWeek } from "./kit-week.ts";
import { tierOf } from "../../config/visit-types.ts";
import { bookedAhead } from "../../config/statuses.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";
import { read, readAll } from "../../lib/read-all.ts";

type UseRow = { technician_id: string; code: string; quantity: number };
type FitRow = {
  technician_id: string;
  person_id: string;
  type: string;
  tier: string | null;
  one_visit: string | null;
  city: string | null;
};
type HeldRow = { place: string; code: string; quantity: number };
type KitSource = { kit: string; source: string | null; source_name: string | null };

/** What each technician's visits tomorrow need, by kit and stock code. */
async function neededTomorrow(
  db: D1Database,
  tomorrow: string,
  range: number,
): Promise<Map<string, Map<string, number>>> {
  const from = indiaInstant(tomorrow, "00:00").toISOString();
  const to = indiaInstant(addDays(tomorrow, 1), "00:00").toISOString();
  const { used, fits } = await readAll(db, {
    used: read<UseRow>(
      db
        .prepare(
          `SELECT a.technician_id, u.consumable_code AS code, SUM(u.quantity) AS quantity
         FROM appointments a JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = ${tierOf("a.tier")}
         WHERE ${bookedAhead("a")} AND a.technician_id IS NOT NULL GROUP BY 1, 2`,
        )
        .bind(from, to),
    ),
    fits: read<FitRow>(
      db
        .prepare(
          `SELECT a.technician_id, a.person_id, a.type, a.tier, a.one_visit, t.city
         FROM appointments a JOIN technicians t ON t.id = a.technician_id
         WHERE ${bookedAhead("a")} AND a.technician_id IS NOT NULL AND a.type IN ('first_fit', 'replacement')`,
        )
        .bind(from, to),
    ),
  });
  const needs = new Map<string, Map<string, number>>();
  const add = (kit: string, code: string, quantity: number) => {
    const kitNeeds = needs.get(kit) ?? new Map<string, number>();
    kitNeeds.set(code, (kitNeeds.get(code) ?? 0) + quantity);
    needs.set(kit, kitNeeds);
  };
  for (const row of used) add(row.technician_id, row.code, row.quantity);
  const fitRows = fits;
  if (fitRows.length === 0) return needs;
  const profiles = await latestFits(
    db,
    fitRows.map((fit) => fit.person_id),
  );
  const specs = await hairSystemSpecs(db);
  const unknown: FitRow[] = [];
  for (const fit of fitRows) {
    const profile = profiles.get(fit.person_id);
    if (profile === undefined) {
      if (fit.one_visit === "booked") unknown.push(fit);
      continue;
    }
    const product = fit.type === "first_fit" ? (fit.tier ?? "standard") : profile.product;
    const code = matchingCode(specs, { ...profile, product });
    if (code !== null) add(fit.technician_id, code, 1);
  }
  const ranges = await oneVisitRanges(
    db,
    unknown.flatMap((fit) => fit.city ?? []),
    range,
  );
  for (const kit of new Set(unknown.map((fit) => fit.technician_id))) {
    const city = unknown.find((fit) => fit.technician_id === kit)?.city ?? "";
    for (const code of ranges.get(city) ?? []) add(kit, code, 1);
  }
  return needs;
}

/** Each city's one-visit range: the hair systems its latest forecast expects most over the horizon. */
async function oneVisitRanges(
  db: D1Database,
  cities: readonly string[],
  range: number,
): Promise<Map<string, string[]>> {
  if (cities.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT l.city, l.consumable_code AS code, SUM(l.expected) AS expected
       FROM forecast_lines l JOIN hair_systems h ON h.code = l.consumable_code
       WHERE l.run_id = (SELECT id FROM forecast_runs INDEXED BY forecast_runs_by_day ORDER BY run_on DESC LIMIT 1)
         AND l.city IN (SELECT value FROM json_each(?1))
       GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2`,
    )
    .bind(JSON.stringify([...new Set(cities)]))
    .all<{ city: string; code: string }>();
  const ranges = new Map<string, string[]>();
  for (const row of results) {
    const held = ranges.get(row.city) ?? [];
    if (held.length < range) ranges.set(row.city, [...held, row.code]);
  }
  return ranges;
}

/** What a kit's top-ups come from holds of each code, so a gap the source cannot fill either is told as one. */
async function heldAtSources(db: D1Database, sources: readonly string[], codes: readonly string[]): Promise<HeldRow[]> {
  if (sources.length === 0 || codes.length === 0) return [];
  const { results } = await db
    .prepare(
      `SELECT place, consumable_code AS code, quantity FROM stock_balances
       WHERE place IN (SELECT value FROM json_each(?1)) AND consumable_code IN (SELECT value FROM json_each(?2))`,
    )
    .bind(JSON.stringify([...new Set(sources)]), JSON.stringify([...new Set(codes)]))
    .all<HeldRow>();
  return results;
}

type Gap = { code: string; gap: number; have: number; needed: number; atSource: number };

/** Ops' line about a kit short, by its technician's ID, which the console names: what it lacks, and what its source has none of either. */
function shortLine(
  kit: { readonly id: string; readonly sourceName: string | null; readonly forTheWeek: boolean },
  gaps: readonly Gap[],
): string {
  return ALERT_WORDS.kit_short({
    kit: kit.id,
    span: kit.forTheWeek ? "the week" : "tomorrow",
    lacks: gaps.map((gap) => `${String(gap.gap)} ${gap.code}`).join(", "),
    source: kit.sourceName,
    nowhere: gaps.filter((gap) => gap.atSource < gap.gap).map((gap) => gap.code),
  });
}

/** What each kit holds and has on its way of what it needs, and each kit's technician and the source of its top-ups. */
async function kitsAndHoldings(db: D1Database, needs: ReadonlyMap<string, ReadonlyMap<string, number>>) {
  const pairs = JSON.stringify(
    [...needs].flatMap(([kit, kitNeeds]) => [...kitNeeds.keys()].map((code) => [code, kit])),
  );
  const { held, places } = await readAll(db, {
    held: read<HeldRow>(
      db
        .prepare(
          `SELECT place, consumable_code AS code, quantity FROM stock_balances
         WHERE (consumable_code, place) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))
           AND quantity > 0
         UNION ALL
         SELECT to_place, consumable_code, quantity FROM stock_transfers
         WHERE state = 'in_transit'
           AND (consumable_code, to_place) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))`,
        )
        .bind(pairs),
    ),
    places: read<KitSource>(
      db
        .prepare(
          `SELECT t.id AS kit, s.id AS source, s.name AS source_name
         FROM technicians t
           LEFT JOIN stock_places s ON s.id = COALESCE(
             (SELECT r.id FROM stock_places r WHERE r.kind = 'stockroom' AND r.city = t.city),
             (SELECT w.id FROM stock_places w WHERE w.kind = 'warehouse'))
         WHERE t.id IN (SELECT value FROM json_each(?1))`,
        )
        .bind(JSON.stringify([...needs.keys()])),
    ),
  });
  const placeRows = places;
  const atSources = await heldAtSources(
    db,
    placeRows.flatMap((row) => row.source ?? []),
    [...needs.values()].flatMap((kitNeeds) => [...kitNeeds.keys()]),
  );
  return { held: held, places: placeRows, atSources };
}

const sumOf = (rows: readonly HeldRow[], place: string, code: string) =>
  rows.reduce((sum, row) => (row.place === place && row.code === code ? sum + row.quantity : sum), 0);

/**
 * Each kit checked against its visits tomorrow, once the evening comes, and on the evening ops set against the week's
 * consumables too: its top-ups proposed on the supply plan, in place of the evening's last, and ops told of each kit
 * short, and of what its source cannot cover either. How many kits are short.
 */
export async function checkTomorrowsKits(
  db: D1Database,
  now: Date,
  alertOnce: AlertOnce,
  kitCheck: KitCheck,
): Promise<number> {
  if (Number(indiaHour(now).slice(11, 13)) < kitCheck.from_hour) return 0;
  const today = indiaDate(now);
  const tomorrow = addDays(today, 1);
  const needs = await neededTomorrow(db, tomorrow, kitCheck.one_visit_range);
  const forTheWeek = weekdayOf(today) === kitCheck.top_up_weekday;
  const levels = forTheWeek ? await addTheWeek(db, needs, tomorrow) : new Map<string, number>();
  if (needs.size === 0) return 0;
  const { held, places, atSources } = await kitsAndHoldings(db, needs);
  const run = `kit-check:${tomorrow}`;
  const at = now.toISOString();
  const lines: D1PreparedStatement[] = [];
  let short = 0;
  for (const [kit, kitNeeds] of needs) {
    const place = places.find((row) => row.kit === kit);
    const source = place?.source ?? null;
    if (place === undefined || source === null) continue;
    const gaps = [...kitNeeds].flatMap(([code, needed]): Gap[] => {
      const have = sumOf(held, kit, code);
      return needed > have
        ? [{ code, gap: needed - have, have, needed, atSource: sumOf(atSources, source, code) }]
        : [];
    });
    if (gaps.length === 0) continue;
    short += 1;
    for (const gap of gaps) {
      const level = levels.get(`${kit} ${gap.code}`) ?? 0;
      lines.push(
        db
          .prepare(
            `INSERT INTO plan_lines (id, run_id, kind, consumable_code, city, from_place, to_place, proposed, usable, need,
               safety, state, drafted_at)
             SELECT ?1, ?2, 'transfer', ?3, t.city, ?4, ?5, ?6, ?7, ?8, ?10, 'proposed', ?9 FROM technicians t WHERE t.id = ?5`,
          )
          .bind(crypto.randomUUID(), run, gap.code, source, kit, gap.gap, gap.have, gap.needed - level, at, level),
      );
    }
    await alertOnce({
      key: `kit_short:${kit}:${tomorrow}`,
      message: shortLine({ id: kit, sourceName: place.source_name, forTheWeek }, gaps),
      link: "/supply-plan",
    });
  }
  await db.batch([db.prepare("DELETE FROM plan_lines WHERE state = 'proposed' AND run_id = ?1").bind(run), ...lines]);
  return short;
}

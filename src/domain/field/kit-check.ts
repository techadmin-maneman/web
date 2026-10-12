// Tomorrow's kits (docs/decisions/0181-tomorrows-kits.md): each evening, each technician's kit against their visits
// tomorrow, each visit's consumables by its service's expected use and each fit's hair system made to its client. What
// a kit is short of becomes a top-up on the supply plan, from its city's stockroom or else the warehouse, which arrives
// once the technician scans it in; and ops are told, once a kit a day.

import { addDays, indiaDate, indiaHour, indiaInstant } from "../../lib/india-time.ts";
import { latestFits } from "../clients/hair-profiles.ts";
import type { AlertOnce } from "../ops/alerts.ts";
import { hairSystemSpecs, matchingCode } from "./hair-systems.ts";

/** The hour, in India, from which the evening's check runs, each hour until the day ends. */
const KIT_CHECK_HOUR = 17;

type UseRow = { technician_id: string; code: string; quantity: number };
type FitRow = { technician_id: string; person_id: string | null; type: string; tier: string | null };
type HeldRow = { place: string; code: string; quantity: number };

/** What each technician's visits tomorrow need, by kit and stock code. */
async function neededTomorrow(db: D1Database, tomorrow: string): Promise<Map<string, Map<string, number>>> {
  const from = indiaInstant(tomorrow, "00:00").toISOString();
  const to = indiaInstant(addDays(tomorrow, 1), "00:00").toISOString();
  const [used, fits] = await db.batch<UseRow | FitRow>([
    db
      .prepare(
        `SELECT a.technician_id, u.consumable_code AS code, SUM(u.quantity) AS quantity
         FROM appointments a JOIN consumable_usage u ON u.visit_type = a.type AND u.tier = COALESCE(a.tier, 'standard')
         WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.status IN ('scheduled', 'dispatched')
           AND a.deleted_at IS NULL AND a.technician_id IS NOT NULL GROUP BY 1, 2`,
      )
      .bind(from, to),
    db
      .prepare(
        `SELECT a.technician_id, a.person_id, a.type, a.tier FROM appointments a
         WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.status IN ('scheduled', 'dispatched')
           AND a.deleted_at IS NULL AND a.technician_id IS NOT NULL AND a.type IN ('first_fit', 'replacement')`,
      )
      .bind(from, to),
  ]);
  const needs = new Map<string, Map<string, number>>();
  const add = (kit: string, code: string, quantity: number) => {
    const kitNeeds = needs.get(kit) ?? new Map<string, number>();
    kitNeeds.set(code, (kitNeeds.get(code) ?? 0) + quantity);
    needs.set(kit, kitNeeds);
  };
  for (const row of (used?.results ?? []) as UseRow[]) add(row.technician_id, row.code, row.quantity);
  const fitRows = (fits?.results ?? []) as FitRow[];
  if (fitRows.length === 0) return needs;
  const profiles = await latestFits(
    db,
    fitRows.flatMap((fit) => fit.person_id ?? []),
  );
  const specs = await hairSystemSpecs(db);
  for (const fit of fitRows) {
    const profile = fit.person_id === null ? undefined : profiles.get(fit.person_id);
    if (profile === undefined) continue;
    const product = fit.type === "first_fit" ? (fit.tier ?? "standard") : profile.product;
    const code = matchingCode(specs, { ...profile, product });
    if (code !== null) add(fit.technician_id, code, 1);
  }
  return needs;
}

/**
 * Each kit checked against its visits tomorrow, once the evening comes: its top-ups proposed on the supply plan, in
 * place of the evening's last, and ops told of each kit short. How many kits are short.
 */
export async function checkTomorrowsKits(db: D1Database, now: Date, alertOnce: AlertOnce): Promise<number> {
  if (Number(indiaHour(now).slice(11, 13)) < KIT_CHECK_HOUR) return 0;
  const tomorrow = addDays(indiaDate(now), 1);
  const needs = await neededTomorrow(db, tomorrow);
  if (needs.size === 0) return 0;
  const kits = JSON.stringify([...needs.keys()]);
  const pairs = JSON.stringify(
    [...needs].flatMap(([kit, kitNeeds]) => [...kitNeeds.keys()].map((code) => [code, kit])),
  );
  const [held, places] = await db.batch<HeldRow | { kit: string; source: string | null; name: string }>([
    db
      .prepare(
        `SELECT place, consumable_code AS code, quantity FROM stock_balances
         WHERE (consumable_code, place) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))
           AND quantity > 0`,
      )
      .bind(pairs),
    db
      .prepare(
        `SELECT t.id AS kit, t.name,
           COALESCE((SELECT r.id FROM stock_places r WHERE r.kind = 'stockroom' AND r.city = t.city),
                    (SELECT w.id FROM stock_places w WHERE w.kind = 'warehouse')) AS source
         FROM technicians t WHERE t.id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(kits),
  ]);
  const heldRows = (held?.results ?? []) as HeldRow[];
  const placeRows = (places?.results ?? []) as { kit: string; source: string | null; name: string }[];
  const run = `kit-check:${tomorrow}`;
  const at = now.toISOString();
  const lines: D1PreparedStatement[] = [];
  let short = 0;
  for (const [kit, kitNeeds] of needs) {
    const place = placeRows.find((row) => row.kit === kit);
    const source = place?.source ?? null;
    if (place === undefined || source === null) continue;
    const gaps = [...kitNeeds].flatMap(([code, needed]) => {
      const have = heldRows.find((row) => row.place === kit && row.code === code)?.quantity ?? 0;
      return needed > have ? [{ code, gap: needed - have, have, needed }] : [];
    });
    if (gaps.length === 0) continue;
    short += 1;
    for (const gap of gaps) {
      lines.push(
        db
          .prepare(
            `INSERT INTO plan_lines (id, run_id, kind, consumable_code, city, from_place, to_place, proposed, usable, need,
               safety, state, drafted_at)
             SELECT ?1, ?2, 'transfer', ?3, t.city, ?4, ?5, ?6, ?7, ?8, 0, 'proposed', ?9 FROM technicians t WHERE t.id = ?5`,
          )
          .bind(crypto.randomUUID(), run, gap.code, source, kit, gap.gap, gap.have, gap.needed, at),
      );
    }
    await alertOnce({
      key: `kit_short:${kit}:${tomorrow}`,
      message: `${place.name}'s kit is short for tomorrow: ${gaps.map((gap) => `${String(gap.gap)} ${gap.code}`).join(", ")}. A top-up waits on the Supply plan.`,
      link: "/supply-plan",
    });
  }
  await db.batch([db.prepare("DELETE FROM plan_lines WHERE state = 'proposed' AND run_id = ?1").bind(run), ...lines]);
  return short;
}

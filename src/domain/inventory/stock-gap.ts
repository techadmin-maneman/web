// A fit booked with no piece of its client's spec in reach (docs/decisions/0173-matching-a-client-to-stock.md): none
// in its technician's kit, their city's stockroom, or on its way to either, and too little time before the visit for
// even the quickest supplier to deliver. Ops are told at the booking, while there is time to move or order one; the
// evening's kit check (./kit-check.ts) tells them again the day before.

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { latestFits } from "../clients/hair-profiles.ts";
import type { AlertOnce } from "../platform/alerts.ts";
import { hairSystemSpecs, matchingCode } from "./hair-systems.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

/**
 * The stock code a fit of the client's takes: their latest profile matched exactly, of `product` where the fit names
 * the package booked, else the profile's own; null with no profile, an incomplete one, or none made to it.
 */
export async function fitCode(db: D1Database, personId: string, product: string | null): Promise<string | null> {
  const fit = (await latestFits(db, [personId])).get(personId);
  if (fit === undefined) return null;
  return matchingCode(await hairSystemSpecs(db), product === null ? fit : { ...fit, product });
}

/**
 * The first day a fit may use the hair system a client is made as `product`, where no place holds one and none is on
 * its way: the day after the quickest supplier still in use can deliver it, as a fit's stock gap reads delivery in
 * time (docs/decisions/0253-replacement-when-due-and-change-of-hair-system.md). Null where one is held or on its way,
 * which ops move as a fit at risk tells them, or no supplier still in use sells it, or the client has no profile.
 */
export async function stockFitsFrom(
  db: D1Database,
  asked: { readonly personId: string; readonly product: string | null; readonly today: string },
): Promise<string | null> {
  const code = await fitCode(db, asked.personId, asked.product);
  if (code === null) return null;
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM stock_balances WHERE consumable_code = ?1 AND quantity > 0)
           OR EXISTS (SELECT 1 FROM stock_transfers INDEXED BY stock_transfers_in_transit
                       WHERE state = 'in_transit' AND consumable_code = ?1) AS held,
         (SELECT MIN(i.lead_time_days) FROM supplier_items i JOIN suppliers s ON s.id = i.supplier_id
           WHERE i.consumable_code = ?1 AND s.retired_at IS NULL) AS lead`,
    )
    .bind(code)
    .first<{ held: number; lead: number | null }>();
  if (row === null || row.held === 1 || row.lead === null) return null;
  return addDays(asked.today, row.lead + 1);
}

/** The places a technician's fit draws on: their kit, and their city's stockroom. `?2` is the technician. */
const IN_REACH = `(SELECT ?2 UNION ALL SELECT r.id FROM stock_places r JOIN technicians t ON t.id = ?2
                   WHERE r.kind = 'stockroom' AND r.city = t.city AND r.active = 1)`;

type Reach = { held: number; moving: number; lead: number | null; name: string | null; city: string | null };

export async function tellOfStockGap(
  db: D1Database,
  fit: {
    readonly appointmentId: string;
    readonly personId: string;
    readonly type: string;
    readonly tier: string | null;
    readonly date: string;
    readonly technicianId: string;
  },
  deps: { readonly alertOnce: AlertOnce; readonly now: Date },
): Promise<void> {
  const code = await fitCode(db, fit.personId, fit.tier);
  if (code === null) return;
  const reach = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b
          WHERE b.consumable_code = ?1 AND b.place IN ${IN_REACH}) AS held,
         (SELECT COALESCE(SUM(x.quantity), 0) FROM stock_transfers x INDEXED BY stock_transfers_in_transit
          WHERE x.state = 'in_transit' AND x.consumable_code = ?1 AND x.to_place IN ${IN_REACH}) AS moving,
         (SELECT MIN(i.lead_time_days) FROM supplier_items i JOIN suppliers s ON s.id = i.supplier_id
          WHERE i.consumable_code = ?1 AND s.retired_at IS NULL) AS lead,
         (SELECT name FROM consumables WHERE code = ?1) AS name,
         (SELECT city FROM technicians WHERE id = ?2) AS city`,
    )
    .bind(code, fit.technicianId)
    .first<Reach>();
  if (reach === null || reach.held + reach.moving > 0) return;
  // Time enough for the quickest supplier to deliver before the visit: the supply plan orders it.
  if (reach.lead !== null && addDays(indiaDate(deps.now), reach.lead) < fit.date) return;
  const quickest =
    reach.lead === null ? "no supplier sells it" : `the quickest supplier takes ${String(reach.lead)} days`;
  await deps.alertOnce({
    key: `fit_without_piece:${fit.appointmentId}`,
    message: ALERT_WORDS.fit_without_piece({
      day: fit.date,
      item: reach.name ?? code,
      city: reach.city ?? "its city",
      quickest,
    }),
    link: "/supply-plan",
  });
}

// Each pincode's centre (docs/decisions/0210-booking-by-start-time.md), asked of Google once, which stands in for a
// client's pin when a drive is estimated before their address has one, as the site's form books with a pincode alone.
// An hourly pass places a few at a time within the day's address-lookup ceiling and the run's outside calls; one
// Google cannot place is asked again a week on.

import type { Alert } from "../../providers/alerts.ts";
import type { GeocodeProvider } from "../../providers/geocode/index.ts";
import type { CallBudget } from "../../lib/call-budget.ts";
import type { Settings } from "../../config/settings.ts";
import type { Logger } from "../../log.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { withinCeiling } from "../platform/ceilings.ts";
import type { Pin } from "../../lib/geo.ts";

/** How many pincodes a pass places: the service area's 204 in under a day. */
const PER_PASS = 20;

/** How long a pincode Google could not place waits before it is asked for again. */
const ASK_AGAIN_DAYS = 7;

interface Pass {
  readonly db: D1Database;
  readonly geocode: GeocodeProvider;
  readonly alert: Alert;
  readonly log: Logger;
  readonly budget: CallBudget;
  readonly settings: Settings;
  readonly now: Date;
}

/** Places the pincodes with no centre yet, a pass's worth. Returns how many it placed. */
export async function placePincodeCentres(pass: Pass): Promise<number> {
  const { db, now } = pass;
  const askedBefore = new Date(now.getTime() - ASK_AGAIN_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT pincode FROM serviceable_pincodes
       WHERE centre_lat IS NULL AND (centre_asked_at IS NULL OR centre_asked_at < ?1)
       LIMIT ?2`,
    )
    .bind(askedBefore, PER_PASS)
    .all<{ pincode: string }>();
  let placed = 0;
  for (const { pincode } of results) {
    if (!pass.budget.spend(1)) break;
    if (!(await withinCeiling(db, pass.alert, "geocode", { now, settings: pass.settings }))) break;
    const answer = await pass.geocode.centreOf(pincode);
    const centre = answer.ok ? { lat: answer.place.lat, lng: answer.place.lng } : null;
    if (!answer.ok) pass.log.warn("pincode_centre_failed", { pincode, reason: answer.reason, detail: answer.detail });
    await db
      .prepare(
        "UPDATE serviceable_pincodes SET centre_lat = ?2, centre_lng = ?3, centre_asked_at = ?4 WHERE pincode = ?1",
      )
      .bind(pincode, centre?.lat ?? null, centre?.lng ?? null, now.toISOString())
      .run();
    if (centre !== null) placed += 1;
  }
  return placed;
}

/** A pincode's centre, where Google has placed it. */
export async function pincodeCentre(db: D1Database, pincode: string): Promise<Pin | null> {
  const row = await db
    .prepare("SELECT centre_lat AS lat, centre_lng AS lng FROM serviceable_pincodes WHERE pincode = ?1")
    .bind(pincode)
    .first<{ lat: number | null; lng: number | null }>();
  return row?.lat === null || row?.lat === undefined || row.lng === null ? null : { lat: row.lat, lng: row.lng };
}

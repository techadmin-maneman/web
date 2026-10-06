// The dispatch board's daily utilisation, kept as an event the day after each day closes (src/domain/dispatch/dispatch.ts draws
// the board it is read from).

import { addDays, indiaDate } from "../../lib/india-time.ts";
import { SLOTS_PER_DAY } from "../../config/scheduling.ts";
import { dispatchBoard } from "./dispatch.ts";

/**
 * "Each column head shows its utilisation, in per cent. This is the operating
 * figure for the model's weekend-share assumption, so it is also written to
 * events daily." One row per India date, written once, the day after it closed,
 * so the figure is the day as it was worked and not as it was booked.
 */
export async function recordUtilisation(db: D1Database, now: Date): Promise<string | null> {
  const date = addDays(indiaDate(now), -1);
  const held = await db
    .prepare("SELECT 1 FROM events WHERE name = 'dispatch_utilisation' AND subject_id = ?1")
    .bind(date)
    .first();
  if (held !== null) return null;

  const board = await dispatchBoard(db, { from: date, city: null });
  const day = board.utilisation.find((entry) => entry.date === date);
  await db
    .prepare("INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(
      crypto.randomUUID(),
      now.toISOString(),
      "dispatch_utilisation",
      date,
      JSON.stringify({
        percent: day?.percent ?? 0,
        technicians: board.technicians.length,
        slots_per_day: SLOTS_PER_DAY,
      }),
    )
    .run();
  return date;
}

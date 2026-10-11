// Each technician's day in the reporting copy (docs/decisions/0146-the-nightly-analytics-copy.md): the half-slots they
// had open and how many were taken, read from the dispatch board so the copy's utilisation is the board's. A day on
// leave has none open, and a job still on it counts for nothing until it is moved, as on the board.

import { UNITS_PER_DAY } from "../../config/scheduling.ts";
import { addDays } from "../../lib/india-time.ts";
import type { Row, TableRows } from "../../providers/warehouse/index.ts";
import { BOARD_DAYS, dispatchBoard } from "../dispatch/dispatch-board.ts";

/** The days ahead the copy holds, four weeks with tonight's date, as far as clients book. */
export const CAPACITY_DAYS_AHEAD = 27;

/**
 * The days from `from` to `to`, for each technician on the board who is not a test record (`cities` gives each one's
 * city). Rows before `from` stay as an earlier night wrote them: a day already worked is kept as it was worked.
 */
export async function capacityRows(
  db: D1Database,
  cities: ReadonlyMap<string, string | null>,
  { from, to, now }: { readonly from: string; readonly to: string; readonly now: Date },
): Promise<TableRows> {
  const rows: Row[] = [];
  for (let week = from; week <= to; week = addDays(week, BOARD_DAYS)) {
    const board = await dispatchBoard(db, { from: week, city: null, now });
    for (const technician of board.technicians) {
      const city = cities.get(technician.technician_id);
      if (city === undefined) continue;
      for (const day of technician.days.filter((each) => each.date <= to)) {
        const away = board.leave.some(
          (period) =>
            period.technician_id === technician.technician_id && period.from <= day.date && day.date <= period.to,
        );
        const taken = day.blocks.reduce((units, block) => units + block.slots * 2, 0);
        rows.push({
          day: day.date,
          technician_key: technician.technician_id,
          city,
          half_slots_open: away ? 0 : UNITS_PER_DAY,
          half_slots_taken: away ? 0 : taken,
          on_leave: away,
        });
      }
    }
  }
  return {
    table: "fact_capacity",
    key: ["day", "technician_key"],
    stamped: true,
    keepBefore: { column: "day", from },
    rows,
  };
}

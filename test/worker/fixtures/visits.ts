// A visit on the books: a service visit in Gurgaon, booked for 10:30 on Tuesday 22 September, India's time, for
// ninety minutes, unless the test says otherwise. What a visit's write keeps up beside it follows, as the domain's
// own writes do (src/domain/visits/visit-upkeep.ts).

import { env } from "cloudflare:workers";
import { visitUpkeep } from "../../../src/domain/visits/visit-upkeep.ts";
import { AT, writeRow, type RowOf } from "./rows.ts";

export async function aVisit(row: RowOf<"appointments"> = {}) {
  const id = row.id ?? crypto.randomUUID();
  const written = await writeRow(
    "appointments",
    {
      id,
      fsm_id: id,
      type: "service",
      status: "scheduled",
      window_start: "2026-09-22T05:00:00.000Z",
      window_end: "2026-09-22T06:30:00.000Z",
      service_city: "Gurgaon",
      service_pincode: "122018",
      synced_at: AT,
    },
    row,
  );
  await env.DB.batch(visitUpkeep(env.DB, { visits: [id] }));
  return written;
}

/**
 * For visits a test writes by hand: what their writes keep up beside them, worked out again for everybody, as the
 * domain's own writes keep it for the people they touch.
 */
export async function keepUpVisits(): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM people").all<{ id: string }>();
  await env.DB.batch(visitUpkeep(env.DB, { people: results.map((row) => row.id) }));
}

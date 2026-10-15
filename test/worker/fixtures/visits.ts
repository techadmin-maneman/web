// A visit on the books: a service visit in Gurgaon for a client of its own, booked for 10:30 on Tuesday 22 September,
// India's time, for ninety minutes from its start, unless the test says otherwise. What a visit's write keeps up beside
// it follows, as the domain's own writes do (src/domain/visits/visit-upkeep.ts). And a visit nobody was home for: the
// technician checked in at the door, waited fifteen minutes and closed it, and ops are still to decide it.

import { env } from "cloudflare:workers";
import { visitUpkeep } from "../../../src/domain/visits/visit-upkeep.ts";
import { aPerson } from "./people.ts";
import { AT, writeRow, type RowOf } from "./rows.ts";

const NINETY_MINUTES = 90 * 60_000;

export async function aVisit(row: RowOf<"appointments"> = {}) {
  const id = row.id ?? crypto.randomUUID();
  const personId = row.person_id ?? (await aPerson()).id;
  const start = row.window_start ?? "2026-09-22T05:00:00.000Z";
  const written = await writeRow(
    "appointments",
    {
      id,
      fsm_id: id,
      person_id: personId,
      type: "service",
      status: "scheduled",
      window_start: start,
      window_end: new Date(Date.parse(start) + NINETY_MINUTES).toISOString(),
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

export async function aNoShow(
  visit: { readonly id: string; readonly technicianId: string },
  row: RowOf<"no_show_cases"> = {},
) {
  const checkin = crypto.randomUUID();
  await writeRow(
    "checkins",
    {
      id: checkin,
      appointment_id: visit.id,
      technician_id: visit.technicianId,
      at: AT,
      lat: 28.4,
      lng: 77.0,
      radius_m: 200,
      passed: 1,
      created_at: AT,
    },
    {},
  );
  return writeRow(
    "no_show_cases",
    {
      id: crypto.randomUUID(),
      checkin_id: checkin,
      appointment_id: visit.id,
      wait_started_at: AT,
      wait_ends_at: AT,
      closed_at: AT,
      decision: "undecided",
      created_at: AT,
    },
    row,
  );
}

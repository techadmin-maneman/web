// What the field work tests share (field-work*.test.ts): the client and a neighbour, today's jobs and technicians, the
// door's place, a time some minutes into the job, and a visit booked.

import { env } from "cloudflare:workers";
import { uuidv7 } from "../../../apps/tech/src/store/uuidv7.ts";
import { NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const NEIGHBOUR = "11111111-1111-4111-8111-111111111112";

export const TODAY_JOB = "22222222-2222-4222-8222-222222222221";

export const OTHER_JOB = "22222222-2222-4222-8222-222222222223";

/** Imran and Sameer, made up. */
export const IMRAN = "33333333-3333-4333-8333-333333333331";

export const SAMEER = "33333333-3333-4333-8333-333333333332";

/** About 90 m from the client's door: inside the geofence. */
export const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

/** Today's job starts at 13:00 in India. */
export const TODAY_START = new Date("2026-09-21T07:30:00.000Z");

export const minutesAfterStart = (minutes: number) => new Date(TODAY_START.getTime() + minutes * 60_000);

/** The event ID the app makes for a write queued that many minutes after the start. */
export const uuidv7At = (minutes: number) => uuidv7(minutesAfterStart(minutes).getTime());

/** A visit booked for Imran, unless another technician is named. */
export async function booked(
  id: string,
  options: { start: string; type?: string; technician?: string; person?: string | null },
) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, 'standard', 'scheduled', ?4, ?5, ?6, 'Gurgaon', '122018', ?7)`,
  )
    .bind(
      id,
      options.person === undefined ? PERSON : options.person,
      options.type ?? "service",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician ?? IMRAN,
      NOW.toISOString(),
    )
    .run();
}

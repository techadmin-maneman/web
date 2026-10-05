// A visit on the books, as the technician's day and the dispatch board read one. Every name and number here is made
// up.

import { env } from "cloudflare:workers";
import { NOW } from "./helpers.ts";

export interface VisitSeed {
  /** Its client; null for one whose client was erased. */
  readonly person: string | null;
  /** Its technician; null for one nobody is booked on yet. */
  readonly technician: string | null;
  /** When its window starts. */
  readonly start: string;
  readonly type?: string;
  readonly status?: string;
  /** How long the technician is booked for: a service visit's 90 minutes unless said. */
  readonly minutes?: number;
  readonly city?: string;
  readonly pincode?: string;
}

export async function visit(id: string, seed: VisitSeed): Promise<void> {
  const end = new Date(Date.parse(seed.start) + (seed.minutes ?? 90) * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      id,
      seed.person,
      seed.type ?? "service",
      seed.status ?? "scheduled",
      seed.start,
      end,
      seed.technician,
      seed.city ?? "Gurgaon",
      seed.pincode ?? "122018",
      NOW.toISOString(),
    )
    .run();
}

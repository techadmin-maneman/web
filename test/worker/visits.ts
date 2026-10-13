// A visit on the books, as the technician's day and the dispatch board read one. Every name and number here is made
// up.

import { aVisit } from "./fixtures/index.ts";

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
  await aVisit({
    id,
    person_id: seed.person,
    technician_id: seed.technician,
    window_start: seed.start,
    window_end: new Date(Date.parse(seed.start) + (seed.minutes ?? 90) * 60_000).toISOString(),
    ...(seed.type === undefined ? {} : { type: seed.type }),
    ...(seed.status === undefined ? {} : { status: seed.status }),
    ...(seed.city === undefined ? {} : { service_city: seed.city }),
    ...(seed.pincode === undefined ? {} : { service_pincode: seed.pincode }),
  });
}

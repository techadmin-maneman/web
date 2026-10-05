// The technicians the browser tests' visits are with. The local database is
// kept from run to run, and each seed used to add a technician of its own every
// run, so the local scheduler came to offer bookings to 155 "Imran Qureshi"s.
// Each seed now names the same one every run. There are three,
// because the booking tests all reach for the same first free day and need
// room for each other (e2e/app/picking.ts).

/** One per seed, the same every run. The booking one keeps the ID it has had since the booking tests began. */
export const E2E_TECHNICIANS = {
  booking: { id: "e2e-booking-technician", fsmId: "e2e-resource-booking" },
  fitted: { id: "e2e00000-0000-4000-8000-00000000f177", fsmId: "e2e-resource-fitted" },
  changing: { id: "e2e00000-0000-4000-8000-0000000c4a96", fsmId: "e2e-resource-changing" },
} as const;

type Seed = keyof typeof E2E_TECHNICIANS;

const everyId = Object.values(E2E_TECHNICIANS)
  .map(({ id }) => `'${id}'`)
  .join(", ");

/**
 * The SQL that gives a seed its technician: added once, whatever number of runs
 * have seeded it before. It also retires what earlier runs left: every other
 * technician an e2e seed ever added, and the seeded visits still ahead with
 * this one or with those, whose tests are long over and which would otherwise
 * fill his days and every local list of what is coming.
 */
export function technicianFor(seed: Seed, now: string): string[] {
  const { id, fsmId } = E2E_TECHNICIANS[seed];
  return [
    `INSERT OR IGNORE INTO technicians (id, fsm_id, name, initials, active, updated_at)
       VALUES ('${id}', '${fsmId}', 'Imran Qureshi', 'IQ', 1, '${now}');`,
    `UPDATE technicians SET active = 0, updated_at = '${now}'
       WHERE fsm_id LIKE 'e2e-%' AND active = 1 AND id NOT IN (${everyId});`,
    `UPDATE appointments SET status = 'cancelled', fsm_status = 'Cancelled', synced_at = '${now}'
       WHERE fsm_id LIKE 'e2e-%' AND status = 'scheduled'
         AND (technician_id = '${id}' OR technician_id NOT IN (${everyId}));`,
  ];
}

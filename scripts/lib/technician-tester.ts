// What `node scripts/staging/seed-technician-tester.ts --clear` deletes from staging: the test technician, the jobs he
// walked and everything they left, and the invented client, save the rows a hair profile points at, which stay. A row
// goes before the rows it refers to, since D1 keeps foreign keys (test/worker/platform/technician-tester.test.ts).

import { sqlLiteral } from "./sql-literal.ts";

/** The statements that clear these test technicians and their clients, in the order they must run. */
export function clearTester(technicianIds: readonly string[], personIds: readonly string[]): string[] {
  const ids = technicianIds.map(sqlLiteral).join(", ");
  const persons = personIds.map(sqlLiteral).join(", ") || "NULL";
  return [
    // A job's use and what was used point at its events, and the kit's stock at the technician. A
    // transfer goes with both its rows, so the central store holds what it held before it.
    `DELETE FROM stock_movements WHERE technician_id IN (${ids})
       OR appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}))
       OR transfer_id IN (SELECT transfer_id FROM stock_movements WHERE technician_id IN (${ids}));`,
    `DELETE FROM consumables_used WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // The client's dispute of a no-show's charge points at the case and at the client.
    `DELETE FROM no_show_disputes WHERE case_id IN (SELECT id FROM no_show_cases WHERE appointment_id IN
       (SELECT id FROM appointments WHERE technician_id IN (${ids})));`,
    `DELETE FROM no_show_cases WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // A check-in that passed points at the event it landed as.
    `DELETE FROM checkins WHERE technician_id IN (${ids})
       OR appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM job_events WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM photos WHERE photo_set_id IN (SELECT id FROM photo_sets WHERE appointment_id IN
       (SELECT id FROM appointments WHERE technician_id IN (${ids})));`,
    `DELETE FROM photo_sets WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM outbound_messages WHERE subject_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // Written if ops move one of the jobs on the dispatch board while the fixture stands.
    `DELETE FROM dispatch_moves WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visit_changes WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visits WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // A hair profile is never deleted (migration 0064), so a job one was taken at, the invented client it is of and
    // the technician who took it stay, the technician made inactive so nothing books or dispatches him; the rest of
    // what they left goes.
    `DELETE FROM appointments WHERE technician_id IN (${ids})
       AND id NOT IN (SELECT appointment_id FROM hair_profiles WHERE appointment_id IS NOT NULL);`,
    `DELETE FROM addresses WHERE person_id IN (${persons});`,
    `DELETE FROM people WHERE id IN (${persons})
       AND id NOT IN (SELECT person_id FROM hair_profiles)
       AND id NOT IN (SELECT person_id FROM appointments WHERE person_id IS NOT NULL);`,
    `DELETE FROM otp_challenges WHERE technician_id IN (${ids});`,
    `DELETE FROM technician_devices WHERE technician_id IN (${ids});`,
    `DELETE FROM sessions WHERE subject_kind = 'technician' AND subject_id IN (${ids});`,
    // An active technician is one the booking availability offers, so something
    // else on staging can take a slot on him while the fixture stands.
    `DELETE FROM slot_claims WHERE technician_id IN (${ids});`,
    `DELETE FROM slot_holds WHERE technician_id IN (${ids});`,
    `UPDATE technicians SET active = 0 WHERE id IN (${ids});`,
    `DELETE FROM technicians WHERE id IN (${ids})
       AND id NOT IN (SELECT technician_id FROM hair_profiles WHERE technician_id IS NOT NULL)
       AND id NOT IN (SELECT technician_id FROM appointments WHERE technician_id IS NOT NULL);`,
  ];
}

// What `node scripts/seed-technician-tester.ts --clear` deletes from staging: the test technician, the jobs he
// walked and everything they left, and the invented client. A row goes before the rows it refers to, since D1
// keeps foreign keys (test/worker/technician-tester.test.ts).

/** A value as SQL: quoted, with its quotes doubled; NULL for null. */
export const quote = (value: string | number | null): string =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;

/** The statements that clear these test technicians and their clients, in the order they must run. */
export function clearTester(technicianIds: readonly string[], personIds: readonly string[]): string[] {
  const ids = technicianIds.map(quote).join(", ");
  const persons = personIds.map(quote).join(", ") || "NULL";
  return [
    // A job's use and what was used point at its events, and the kit's stock at the technician. A
    // transfer goes with both its rows, so the central store holds what it held before it.
    `DELETE FROM stock_movements WHERE technician_id IN (${ids})
       OR appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}))
       OR transfer_id IN (SELECT transfer_id FROM stock_movements WHERE technician_id IN (${ids}));`,
    `DELETE FROM consumables_used WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM job_events WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // The client's dispute of a no-show's charge points at the case and at the client.
    `DELETE FROM no_show_disputes WHERE case_id IN (SELECT id FROM no_show_cases WHERE appointment_id IN
       (SELECT id FROM appointments WHERE technician_id IN (${ids})));`,
    `DELETE FROM no_show_cases WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM checkins WHERE technician_id IN (${ids});`,
    `DELETE FROM photos WHERE photo_set_id IN (SELECT id FROM photo_sets WHERE appointment_id IN
       (SELECT id FROM appointments WHERE technician_id IN (${ids})));`,
    `DELETE FROM photo_sets WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM outbound_messages WHERE subject_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    // Written if ops move one of the jobs on the dispatch board while the fixture stands.
    `DELETE FROM dispatch_moves WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visit_changes WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM visits WHERE appointment_id IN (SELECT id FROM appointments WHERE technician_id IN (${ids}));`,
    `DELETE FROM appointments WHERE technician_id IN (${ids});`,
    `DELETE FROM addresses WHERE person_id IN (${persons});`,
    `DELETE FROM people WHERE id IN (${persons});`,
    `DELETE FROM otp_challenges WHERE technician_id IN (${ids});`,
    `DELETE FROM technician_devices WHERE technician_id IN (${ids});`,
    `DELETE FROM sessions WHERE subject_kind = 'technician' AND subject_id IN (${ids});`,
    // An active technician is one the booking availability offers, so something
    // else on staging can take a slot on him while the fixture stands.
    `DELETE FROM slot_claims WHERE technician_id IN (${ids});`,
    `DELETE FROM slot_holds WHERE technician_id IN (${ids});`,
    `DELETE FROM technicians WHERE id IN (${ids});`,
  ];
}

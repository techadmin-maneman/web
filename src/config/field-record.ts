// Which system holds the record of field work: Zoho FSM, or our own database. FSM_PROVIDER decides while both paths
// exist. "zoho" and "stub" keep FSM's path; "none" means D1 is the record.

import type { Providers } from "./environments.ts";

export type FieldRecord = "fsm" | "ours";

export function fieldRecord(providers: Pick<Providers, "FSM_PROVIDER">): FieldRecord {
  return providers.FSM_PROVIDER === "none" ? "ours" : "fsm";
}

/**
 * Who holds the record of one visit's work: FSM only on its path, and only for a visit FSM holds. A visit FSM never
 * held carries its own ID as its FSM ID, and our own database is its record on either path.
 */
export function recordOfVisit(
  record: FieldRecord,
  visit: { readonly id: string; readonly fsmId: string },
): FieldRecord {
  return record === "fsm" && visit.fsmId !== visit.id ? "fsm" : "ours";
}

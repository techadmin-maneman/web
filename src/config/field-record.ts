// Which system holds the record of field work: Zoho FSM, or our own database. FSM_PROVIDER decides while both paths
// exist. "zoho" and "stub" keep FSM's path; "none" means D1 is the record.

import type { Providers } from "./environments.ts";

export type FieldRecord = "fsm" | "ours";

export function fieldRecord(providers: Pick<Providers, "FSM_PROVIDER">): FieldRecord {
  return providers.FSM_PROVIDER === "none" ? "ours" : "fsm";
}

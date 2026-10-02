// Who may change a technician in the console. While FSM is the record of field work, its nightly sync writes over
// every technician it lists, so ops change only the ones they added; once our own database is the record, every
// technician is ours.

import type { FieldRecord } from "../config/field-record.ts";

export function isOursToChange(record: FieldRecord, handWritten: boolean): boolean {
  return record === "ours" || handWritten;
}

// The job sheet a technician fills in, step by step (src/policy/in-job-steps.ts):
// the committed lists, which stand until ops set their own.
//
// Ops set the job sheet in the console (docs/decisions/0087-consumables-and-stock.md), so the lists here are what a
// kind of visit takes until ops save its checklist, and what the reasons are until ops save theirs
// (src/domain/job-sheet-settings.ts). Every label the design does not draw is a placeholder (open point 28).
//
// Consumables are not here: ops keep their catalogue, and what each service is
// expected to use, in the console (src/domain/consumables.ts).

import type { VisitType } from "./visit-types.ts";

/** One item of a list: the code the app sends back, and the words the technician reads. */
export interface JobSheetItem {
  readonly id: string;
  readonly label: string;
}

/**
 * The checklist per visit type. A service visit has the design's six items;
 * the other types have the steps their screens show. The client reads the
 * labels too, under "What was done", so a piece is their hair system. The ids
 * are what a visit records, and never change.
 */
export const CHECKLIST: Readonly<Record<VisitType, readonly JobSheetItem[]>> = {
  // PLACEHOLDER: the consultation's checklist, until ops give theirs (open point 28).
  consultation: [
    { id: "scalp_checked", label: "Scalp and hairline checked" },
    { id: "measurements_taken", label: "Measurements taken" },
    { id: "options_shown", label: "Options and prices shown" },
  ],
  // PLACEHOLDER: the first fit's checklist, until ops give theirs (open point 28).
  first_fit: [
    { id: "template_checked", label: "Template checked against the head" },
    { id: "base_trimmed", label: "Base trimmed and shaped" },
    { id: "adhesive_applied", label: "Adhesive applied" },
    { id: "piece_set", label: "Hair system set and pressed" },
    { id: "cut_and_styled", label: "Cut and styled" },
    { id: "aftercare_explained", label: "Aftercare explained" },
  ],
  // PLACEHOLDER: the service visit's checklist, until ops give theirs (open point 28).
  service: [
    { id: "piece_removed", label: "Hair system removed" },
    { id: "scalp_cleaned", label: "Scalp cleaned" },
    { id: "piece_cleaned", label: "Hair system cleaned" },
    { id: "adhesive_renewed", label: "Adhesive renewed" },
    { id: "piece_refitted", label: "Hair system refitted" },
    { id: "cut_and_styled", label: "Cut and styled" },
  ],
  // PLACEHOLDER: the replacement's checklist, until ops give theirs (open point 28).
  replacement: [
    { id: "old_piece_removed", label: "Old hair system removed" },
    { id: "scalp_cleaned", label: "Scalp cleaned" },
    { id: "new_piece_checked", label: "New hair system checked against its label" },
    { id: "adhesive_applied", label: "Adhesive applied" },
    { id: "piece_set", label: "Hair system set and pressed" },
    { id: "cut_and_styled", label: "Cut and styled" },
  ],
};

/**
 * The four reasons the design lists behind "Partial · pick a reason". Only
 * "client stopped it" is named there, so the other three are placeholders.
 * "Ops needs the full set — these drive the task queue", which is why a reason
 * is checked against the list in force before any write.
 */
export const PARTIAL_REASONS: readonly JobSheetItem[] = [
  { id: "client_stopped_it", label: "Client stopped it partway" },
  // PLACEHOLDER: three reasons the design does not name, until ops give theirs (open point 28).
  { id: "piece_not_ready", label: "Hair system not ready" },
  { id: "client_unwell", label: "Client unwell" },
  { id: "more_time_needed", label: "More time needed" },
];

/**
 * What ops may set a list to. A checklist the technician cannot finish, or a
 * Partial with no reason to pick, would strand a job, so a list is never
 * empty; the checklist route takes twenty ticked at most; and a label is read
 * at arm's length, one to a row.
 */
export const JOB_SHEET_BOUNDS = { maxChecklistItems: 20, maxPartialReasons: 12, maxLabel: 80 } as const;

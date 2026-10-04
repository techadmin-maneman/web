// The job sheet a technician fills in, step by step (src/policy/in-job-steps.ts):
// the committed lists, which stand until ops set their own.
//
// The prompt puts the checklist and the partial reasons in config, "taken from
// the FSM job-sheet template". There was no template, and the owner ruled on
// 27 September 2026 that the job sheet is set in the ops console instead (docs/open-points.md,
// item 28; docs/decisions/0087-consumables-and-stock.md). So the lists here are
// what a kind of visit takes until ops save its checklist, and what the reasons
// are until ops save theirs (src/domain/job-sheet-settings.ts). Every label the
// design does not draw is a placeholder.
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
 * the other types have the steps their screens show. Every label is a
 * placeholder (open point 28).
 */
export const CHECKLIST: Readonly<Record<VisitType, readonly JobSheetItem[]>> = {
  consultation: [
    { id: "scalp_checked", label: "PLACEHOLDER Scalp and hairline checked" },
    { id: "measurements_taken", label: "PLACEHOLDER Measurements taken" },
    { id: "options_shown", label: "PLACEHOLDER Options and prices shown" },
  ],
  first_fit: [
    { id: "template_checked", label: "PLACEHOLDER Template checked against the head" },
    { id: "base_trimmed", label: "PLACEHOLDER Base trimmed and shaped" },
    { id: "adhesive_applied", label: "PLACEHOLDER Adhesive applied" },
    { id: "piece_set", label: "PLACEHOLDER Piece set and pressed" },
    { id: "cut_and_styled", label: "PLACEHOLDER Cut and styled" },
    { id: "aftercare_explained", label: "PLACEHOLDER Aftercare explained" },
  ],
  service: [
    { id: "piece_removed", label: "PLACEHOLDER Piece removed" },
    { id: "scalp_cleaned", label: "PLACEHOLDER Scalp cleaned" },
    { id: "piece_cleaned", label: "PLACEHOLDER Piece cleaned" },
    { id: "adhesive_renewed", label: "PLACEHOLDER Adhesive renewed" },
    { id: "piece_refitted", label: "PLACEHOLDER Piece refitted" },
    { id: "cut_and_styled", label: "PLACEHOLDER Cut and styled" },
  ],
  replacement: [
    { id: "old_piece_removed", label: "PLACEHOLDER Old piece removed" },
    { id: "scalp_cleaned", label: "PLACEHOLDER Scalp cleaned" },
    { id: "new_piece_checked", label: "PLACEHOLDER New piece checked against the label" },
    { id: "adhesive_applied", label: "PLACEHOLDER Adhesive applied" },
    { id: "piece_set", label: "PLACEHOLDER Piece set and pressed" },
    { id: "cut_and_styled", label: "PLACEHOLDER Cut and styled" },
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
  { id: "piece_not_ready", label: "PLACEHOLDER The piece was not ready" },
  { id: "client_unwell", label: "PLACEHOLDER Client unwell" },
  { id: "more_time_needed", label: "PLACEHOLDER More time needed" },
];

/**
 * What ops may set a list to. A checklist the technician cannot finish, or a
 * Partial with no reason to pick, would strand a job, so a list is never
 * empty; the checklist route takes twenty ticked at most; and a label is read
 * at arm's length, one to a row.
 */
export const JOB_SHEET_BOUNDS = { maxChecklistItems: 20, maxPartialReasons: 12, maxLabel: 80 } as const;

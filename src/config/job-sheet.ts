// The job sheet a technician fills in, step by step (src/policy/in-job-steps.ts).
//
// The prompt puts the checklist and the partial reasons in config, "taken from
// the FSM job-sheet template". The trial found no template in the org yet
// (`meta/job_sheet_forms` is empty), so everything here is a placeholder until
// the owner builds it (docs/open-points.md, item 13). Consumables are not
// listed at all: the technician names what he used, and migration 0026 keeps
// the name as he entered it until FSM's catalogue can be matched against.

import type { VisitType } from "./visit-types.ts";

/** One checklist item: an ID the app sends back, and the words the technician reads. */
export interface ChecklistItem {
  readonly id: string;
  readonly label: string;
}

/**
 * The checklist per visit type. A service visit has the design's six items;
 * the other types have the steps their screens show. Every label is a
 * placeholder (item 13).
 */
export const CHECKLIST: Readonly<Record<VisitType, readonly ChecklistItem[]>> = {
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
 * "Ops needs the full set — these drive the task queue", which is why the list
 * is one place and the reason is checked against it before any write.
 */
export const PARTIAL_REASONS = ["client_stopped_it", "piece_not_ready", "client_unwell", "more_time_needed"] as const;
export type PartialReason = (typeof PARTIAL_REASONS)[number];

export const isPartialReason = (reason: string): reason is PartialReason =>
  (PARTIAL_REASONS as readonly string[]).includes(reason);

/** The IDs of a visit type's checklist, for checking what the app sends back. */
export const checklistIds = (type: VisitType): Set<string> => new Set(CHECKLIST[type].map((item) => item.id));

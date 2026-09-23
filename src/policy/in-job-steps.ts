// The steps of a job, one screen each (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, and the order the steps run in.

export const RULES = [
  "Five before photographs: front, top, left, right, hair.",
  "The service checklist. Six items for a service visit. The list is per visit type and lives in config, taken from the FSM job-sheet template.",
  "Consumables used, with quantities.",
  "The piece: replacement jobs only. Scan the label code (for example MM-STD-4417-B) or pick from the client's pieces in FSM.",
  "Five after photographs.",
  "Outcome: Done, or Partial with a reason.",
  "The design says ops need the full set because these drive the task queue. Make the reasons an FSM-synced list and flag it in an ADR.",
  "Duration runs from Start job to the outcome. The technician never types a time.",
] as const;

/** The five angles of a before or after set, in the order they are taken. */
export const PHOTO_ANGLES = ["front", "top", "left", "right", "hair"] as const;
export type PhotoAngle = (typeof PHOTO_ANGLES)[number];

/**
 * The steps in the order the design's screens run, after the job is started.
 * A step may be sent again (the phone replays its outbox), but never before
 * the one ahead of it: the server checks the order so a job sheet cannot be
 * closed out of an empty screen.
 */
export const JOB_STEPS = ["before_photos", "checklist", "consumables", "piece", "after_photos", "outcome"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** Every kind of event the phone's outbox can carry, in the order they happen. */
export const JOB_EVENT_KINDS = ["check_in", "start", ...JOB_STEPS] as const;
export type JobEventKind = (typeof JOB_EVENT_KINDS)[number];

/** "The piece: replacement jobs only." */
export const PIECE_STEP_TYPES = ["replacement", "first_fit"] as const;

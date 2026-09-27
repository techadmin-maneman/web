// The steps of a job, one screen each (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rules as the prompt states them, the order the steps run in, and the check that holds a phone to that order
// (docs/decisions/0038-offline-writes.md). Each step lands in src/domain/job-events.ts and reaches FSM from
// src/queues/fsm-sync.ts.

import type { VisitType } from "../config/visit-types.ts";

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

/**
 * "The piece: replacement jobs only." A first fit takes the step as well, since it fits the client's first piece
 * (docs/decisions/0038-offline-writes.md).
 */
export const PIECE_STEP_TYPES = ["replacement", "first_fit"] as const;

/** The steps this visit type runs, in order. */
export function stepsFor(type: VisitType): JobStep[] {
  const takesPiece = (PIECE_STEP_TYPES as readonly string[]).includes(type);
  return JOB_STEPS.filter((step) => step !== "piece" || takesPiece);
}

/** Whether an event closes the job as a no-show (src/policy/no-show.ts). */
export const isNoShow = (kind: JobEventKind, body: Record<string, unknown>): boolean =>
  kind === "outcome" && body.outcome === "no_show";

/**
 * The step this one must follow, given the kinds the job has landed; null when it may land now. A check-in comes
 * first, then the start, then the steps in their order. A no-show closes a job that was never started, so it needs
 * only the check-in its wait ran from.
 */
export function stepBefore(
  kind: JobEventKind,
  type: VisitType,
  done: ReadonlySet<string>,
  body: Record<string, unknown>,
): JobEventKind | null {
  if (kind === "check_in") return null;
  if (kind === "start" || isNoShow(kind, body)) return done.has("check_in") ? null : "check_in";
  if (!done.has("start")) return "start";
  const wanted: readonly JobEventKind[] = stepsFor(type);
  const position = wanted.indexOf(kind);
  if (position <= 0) return null;
  const previous = wanted[position - 1];
  return previous === undefined || done.has(previous) ? null : previous;
}

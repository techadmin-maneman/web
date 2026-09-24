// What each event of the technician's outbox writes to Zoho FSM
// (docs/decisions/0038-offline-writes.md, 0032-fsm-mirror.md).
//
// FSM is the record. The trial found the org has no job-sheet template yet
// (`meta/job_sheet_forms` is empty, docs/open-points.md, item 13), so there is
// no job-sheet record to create; until there is, the checklist, the consumables
// and the outcome are written on the appointment itself, as its summary and as
// the mandatory note of the transition that closes it. Our own job_events keep
// the same facts field by field, so they can be replayed into job-sheet records
// the day the template exists.
//
// Every call here throws when FSM refuses, so the fsm-sync queue retries it
// rather than losing the technician's work.

import { CHECKLIST } from "../config/job-sheet.ts";
import { cycleDaysFor, type Cycles } from "../config/pieces.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaIso } from "../lib/india-time.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { eventsOf, type JobEvent } from "./job-events.ts";
import { recordFittedPiece, recordFailedPiece } from "./pieces.ts";
import { attachPhotosToFsm } from "./tech-photos.ts";

export interface JobForFsm {
  readonly id: string;
  readonly fsmId: string;
  readonly type: VisitType;
  readonly personId: string | null;
  readonly fsmContactId: string | null;
}

export interface FsmWriteDeps {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly fsm: FsmProvider;
  readonly labelAsTest: boolean;
  /** The replacement cycles in force, which ops set (ADR 0060). */
  readonly cycles: Cycles;
}

/** What the write did, for the log: never the event's contents. */
export type FsmWriteOutcome = "written" | "nothing_to_write";

/** Writes one event to FSM. Throws on refusal, so the queue retries it. */
export async function writeEventToFsm(
  deps: FsmWriteDeps,
  job: JobForFsm,
  event: JobEvent,
  now: Date,
): Promise<FsmWriteOutcome> {
  const { db, fsm } = deps;
  switch (event.kind) {
    case "check_in": {
      // The technician is on site: FSM's own Dispatch transition says so.
      const note = `${prefix(deps)}Technician checked in at ${asText(event.body.at) ?? event.occurredAt}.`;
      return (await fsm.transitionAppointment(job.fsmId, "Dispatch", note)) ? "written" : "nothing_to_write";
    }
    case "start": {
      await fsm.updateAppointment(job.fsmId, { Actual_Start_Date_Time: indiaIsoOf(event.occurredAt) });
      await fsm.transitionAppointment(job.fsmId, "Start", `${prefix(deps)}Job started.`);
      return "written";
    }
    case "before_photos":
    case "after_photos": {
      const phase = event.kind === "before_photos" ? "before" : "after";
      const attached = await attachPhotosToFsm(db, deps.bucket, fsm, job, phase);
      return attached > 0 ? "written" : "nothing_to_write";
    }
    case "piece": {
      await writePiece(deps, job, event, now);
      await fsm.updateAppointment(job.fsmId, { Summary: await summaryOf(db, job, deps) });
      return "written";
    }
    case "checklist":
    case "consumables": {
      await fsm.updateAppointment(job.fsmId, { Summary: await summaryOf(db, job, deps) });
      return "written";
    }
    case "outcome": {
      await fsm.updateAppointment(job.fsmId, {
        Summary: await summaryOf(db, job, deps),
        Actual_End_Date_Time: indiaIsoOf(event.occurredAt),
      });
      const outcome = asText(event.body.outcome) ?? "";
      const transition = outcome === "done" ? "Complete" : "Terminate";
      const note = `${prefix(deps)}${await closingNote(db, job, event)}`;
      await fsm.transitionAppointment(job.fsmId, transition, note);
      return "written";
    }
  }
}

/** The piece step: a fitted piece becomes an FSM asset, a failed one is marked there. */
async function writePiece(deps: FsmWriteDeps, job: JobForFsm, event: JobEvent, now: Date): Promise<void> {
  const code = typeof event.body.piece_code === "string" ? event.body.piece_code : null;
  if (code === null) return;
  const failure = typeof event.body.failure_reason === "string" ? event.body.failure_reason : null;

  if (failure !== null) {
    await recordFailedPiece(deps.db, deps.fsm, { pieceCode: code, reason: failure, now });
    return;
  }
  if (job.personId === null || job.fsmContactId === null) return;
  const base = typeof event.body.base === "string" ? event.body.base : null;
  const lot = typeof event.body.supplier_lot === "string" ? event.body.supplier_lot : null;
  await recordFittedPiece(deps.db, deps.fsm, {
    personId: job.personId,
    fsmContactId: job.fsmContactId,
    appointmentId: job.id,
    pieceCode: code,
    base,
    supplierLot: lot,
    fittedOn: event.occurredAt.slice(0, 10),
    replacementDue: addDays(event.occurredAt.slice(0, 10), cycleDaysFor(base, deps.cycles)),
    now,
  });
}

/**
 * The job sheet as one line of text, rebuilt from the events each time it is
 * written, so a replay writes the same thing. No name, number or amount.
 */
export async function summaryOf(db: D1Database, job: JobForFsm, deps: { labelAsTest: boolean }): Promise<string> {
  const events = await eventsOf(db, job.id);
  const parts = [`${prefix(deps)}${FSM_SERVICE_NAMES[job.type]}`];

  const checklist = events.findLast((event) => event.kind === "checklist");
  if (checklist !== undefined) {
    const doneIds = new Set(asStrings(checklist.body.done));
    const labels = CHECKLIST[job.type].filter((item) => doneIds.has(item.id)).map((item) => item.label);
    parts.push(`Checklist ${String(labels.length)}/${String(CHECKLIST[job.type].length)}: ${labels.join(", ")}`);
  }

  const consumables = events.findLast((event) => event.kind === "consumables");
  if (consumables !== undefined) {
    const used = asItems(consumables.body.items).map((item) => `${item.name} x${String(item.quantity)}`);
    if (used.length > 0) parts.push(`Consumables: ${used.join(", ")}`);
  }

  const piece = events.findLast((event) => event.kind === "piece");
  if (piece !== undefined && typeof piece.body.piece_code === "string") {
    parts.push(`Piece: ${piece.body.piece_code}`);
  }

  const outcome = events.findLast((event) => event.kind === "outcome");
  if (outcome !== undefined) parts.push(outcomeLine(outcome));
  return parts.join(" · ");
}

/** The mandatory note on the transition that closes the job. */
async function closingNote(db: D1Database, job: JobForFsm, event: JobEvent): Promise<string> {
  const events = await eventsOf(db, job.id);
  const start = events.find((candidate) => candidate.kind === "start");
  const minutes =
    start === undefined
      ? null
      : Math.max(0, Math.round((Date.parse(event.occurredAt) - Date.parse(start.occurredAt)) / 60_000));
  const duration = minutes === null ? "" : ` Duration ${String(minutes)} minutes.`;
  return `${outcomeLine(event)}.${duration}`;
}

function outcomeLine(event: JobEvent): string {
  const outcome = asText(event.body.outcome) ?? "";
  const reason = asText(event.body.reason);
  if (outcome === "done") return "Outcome: done";
  if (outcome === "no_show") return "Outcome: client not home";
  return `Outcome: partial${reason === null ? "" : ` (${reason})`}`;
}

/** Staging shares the real FSM org, so everything it writes says so (docs/open-points.md, item 10). */
const prefix = (deps: { labelAsTest: boolean }): string => (deps.labelAsTest ? "Staging test: " : "");

const indiaIsoOf = (instant: string): string => indiaIso(new Date(instant));

/** One field of an event's body, when the phone sent it as text; null otherwise. */
const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asItems(value: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = item as { name?: unknown; quantity?: unknown };
    return typeof row.name === "string" && typeof row.quantity === "number"
      ? [{ name: row.name, quantity: row.quantity }]
      : [];
  });
}

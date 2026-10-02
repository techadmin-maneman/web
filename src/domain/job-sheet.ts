// What each event of the technician's outbox writes to Zoho FSM
// (docs/decisions/0038-offline-writes.md, 0032-fsm-mirror.md).
//
// FSM is the record. The trial found the org has no job-sheet template
// (`meta/job_sheet_forms` is empty), and the owner ruled on 27 September 2026
// that the job sheet is set in the ops console instead (docs/open-points.md,
// item 28): so the checklist, the consumables and the outcome are written on
// the appointment itself, as its summary and as the mandatory note of the
// transition that closes it, in the words the console gives them. Our own
// job_events keep the same facts field by field.
//
// What was used is internal: it is on the summary, and in our own records from
// the moment the step lands (src/domain/stock.ts), and never a line of the work
// order, so the client's invoice is as it was
// (docs/decisions/0087-consumables-and-stock.md).
//
// Every call here throws when FSM refuses, so the fsm-sync queue retries it
// rather than losing the technician's work. That includes a transition FSM
// does not offer: the org names its own (src/providers/fsm.ts), and a job whose
// start or close FSM never took must never be counted as written
// (docs/decisions/0065-a-technicians-writes-reach-fsm.md).

import { cycleDaysFor, type Cycles } from "../config/pieces.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaIso } from "../lib/india-time.ts";
import { STATUS_AFTER, type AppointmentTransition, type FsmProvider } from "../providers/fsm.ts";
import { allConsumables } from "./consumables.ts";
import { statusOf } from "./fsm-mirror.ts";
import { eventsOf, type JobEvent } from "./job-events.ts";
import { checklistOf, jobSheet } from "./job-sheet-settings.ts";
import { recordFittedPiece, recordFailedPiece } from "./pieces.ts";
import { attachPhotosToFsm } from "./tech-photos.ts";
import { minutesBetween } from "../lib/durations.ts";

export interface JobForFsm {
  readonly id: string;
  readonly fsmId: string;
  readonly type: VisitType;
  /** A consultation and fit in one visit, which keeps the first fit's steps however it closed. */
  readonly oneVisit: boolean;
  readonly personId: string | null;
  readonly fsmContactId: string | null;
}

export interface FsmWriteDeps {
  readonly db: D1Database;
  readonly bucket: R2Bucket;
  readonly fsm: FsmProvider;
  readonly labelAsTest: boolean;
  /** The replacement cycles in force, which ops set (ADR 0061). */
  readonly cycles: Cycles;
}

/** What the write did, for the log: never the event's contents. */
export type FsmWriteOutcome = "written" | "nothing_to_write";

/** The transitions a technician's job makes, in the order it makes them. */
type JobTransition = Extract<AppointmentTransition, "Dispatch" | "Start Work" | "Complete Work" | "Terminate">;

/**
 * Where FSM is once each step is behind it. A transition FSM no longer offers
 * from one of these statuses is one it has already made — ops moved the job in
 * FSM's own screen — and nothing of the technician's is lost.
 */
const ALREADY_PAST: Readonly<Record<JobTransition, readonly string[]>> = {
  Dispatch: ["Dispatched", "In Progress", "Completed", "Terminated"],
  "Start Work": ["In Progress", "Completed", "Terminated"],
  "Complete Work": ["Completed"],
  Terminate: ["Terminated"],
};

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
      const note = `${prefix(deps)}Technician checked in at ${indiaIsoOf(event.occurredAt)}.`;
      return moveAppointment(deps, job, "Dispatch", note);
    }
    case "start": {
      await fsm.updateAppointment(job.fsmId, { Actual_Start_Date_Time: indiaIsoOf(event.occurredAt) });
      await moveAppointment(deps, job, "Start Work", `${prefix(deps)}Job started.`);
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
      const transition = outcome === "done" ? "Complete Work" : "Terminate";
      const note = `${prefix(deps)}${await closingNote(db, job, event)}`;
      await moveAppointment(deps, job, transition, note);
      return "written";
    }
  }
}

/**
 * Moves the appointment on by one transition. FSM offers only what its
 * blueprint allows from where the appointment is, so one it does not offer is
 * either behind it already or refused, and the appointment's status says
 * which. A refusal throws: the queue tries again, and alerts after its last
 * attempt, rather than counting a step FSM never took as written.
 *
 * Once FSM has taken the step, the mirror takes its status at once, so the
 * board and the client's app follow the job without waiting for FSM's webhook.
 */
async function moveAppointment(
  deps: FsmWriteDeps,
  job: JobForFsm,
  transition: JobTransition,
  note: string,
): Promise<FsmWriteOutcome> {
  if (await deps.fsm.transitionAppointment(job.fsmId, transition, note)) {
    await mirrorStatus(deps.db, job.id, STATUS_AFTER[transition]);
    return "written";
  }

  const status = (await deps.fsm.appointment(job.fsmId))?.status;
  if (status === undefined || !ALREADY_PAST[transition].includes(status)) {
    throw new Error(`FSM does not offer ${transition} on this appointment, which is ${status ?? "not in FSM"}`);
  }
  await mirrorStatus(deps.db, job.id, status);
  return "nothing_to_write";
}

/** FSM's status word over the mirror's copy; the webhook's full read follows and agrees. */
async function mirrorStatus(db: D1Database, appointmentId: string, fsmStatus: string): Promise<void> {
  await db
    .prepare("UPDATE appointments SET status = ?2, fsm_status = ?3 WHERE id = ?1")
    .bind(appointmentId, statusOf(fsmStatus), fsmStatus)
    .run();
}

/**
 * The piece step: on a replacement the piece that came off is marked failed in
 * FSM first, then the fitted one becomes an FSM asset. A failure_reason on the
 * piece itself marks that piece failed and fits nothing.
 */
async function writePiece(deps: FsmWriteDeps, job: JobForFsm, event: JobEvent, now: Date): Promise<void> {
  const oldPiece = asOldPiece(event.body.old_piece);
  if (oldPiece !== null) {
    await recordFailedPiece(deps.db, deps.fsm, { pieceCode: oldPiece.pieceCode, reason: oldPiece.reason, now });
  }

  const code = asText(event.body.piece_code);
  if (code === null) return;
  const failure = asText(event.body.failure_reason);
  if (failure !== null) {
    await recordFailedPiece(deps.db, deps.fsm, { pieceCode: code, reason: failure, now });
    return;
  }
  if (job.personId === null || job.fsmContactId === null) return;
  const base = asText(event.body.base);
  const lot = asText(event.body.supplier_lot);
  // The day in India the phone fitted it, not the day the write reached us.
  const fittedOn = indiaDate(new Date(event.occurredAt));
  await recordFittedPiece(deps.db, deps.fsm, {
    personId: job.personId,
    fsmContactId: job.fsmContactId,
    appointmentId: job.id,
    pieceCode: code,
    base,
    supplierLot: lot,
    fittedOn,
    replacementDue: addDays(fittedOn, cycleDaysFor(base, deps.cycles)),
    now,
  });
}

/**
 * The job sheet as one line of text, rebuilt from the events each time it is
 * written, so a replay writes the same thing. No name, number or amount.
 */
export async function summaryOf(db: D1Database, job: JobForFsm, deps: { labelAsTest: boolean }): Promise<string> {
  const events = await eventsOf(db, job.id);
  const name = job.oneVisit ? ONE_VISIT_NAME : FSM_SERVICE_NAMES[job.type];
  const parts = [`${prefix(deps)}${name}`];

  // The words ops gave each item; one they have since taken off is still named, and not counted against the list.
  const checklist = events.findLast((event) => event.kind === "checklist");
  if (checklist !== undefined) {
    const list = checklistOf(await jobSheet(db), job);
    const doneIds = new Set(asStrings(checklist.body.done));
    const ticked = [...list.items, ...list.retired].filter((item) => doneIds.has(item.id));
    const inList = list.items.filter((item) => doneIds.has(item.id)).length;
    const labels = ticked.map((item) => item.label).join(", ");
    parts.push(`Checklist ${String(inList)}/${String(list.items.length)}: ${labels}`);
  }

  // By each consumable's name in the console, or as a phone that knew no codes entered it.
  const consumables = events.findLast((event) => event.kind === "consumables");
  if (consumables !== undefined) {
    const names = new Map((await allConsumables(db)).map((consumable) => [consumable.code, consumable.name]));
    const used = asItems(consumables.body.items).map(
      (item) => `${item.code === null ? item.name : (names.get(item.code) ?? item.code)} x${String(item.quantity)}`,
    );
    if (used.length > 0) parts.push(`Consumables: ${used.join(", ")}`);
  }

  const piece = events.findLast((event) => event.kind === "piece");
  if (piece !== undefined) parts.push(...pieceLines(piece));

  const outcome = events.findLast((event) => event.kind === "outcome");
  if (outcome !== undefined) parts.push(outcomeLine(outcome));
  return parts.join(" · ");
}

/**
 * The piece as the summary gives it. A failure's reason goes here as well as on
 * our copy, since FSM holds nothing else of it: the asset only turns Inactive.
 */
function pieceLines(event: JobEvent): string[] {
  if (event.body.declined === true) return ["No piece: the client decided against the fit"];
  const lines: string[] = [];
  const oldPiece = asOldPiece(event.body.old_piece);
  if (oldPiece !== null) lines.push(`Piece off: ${oldPiece.pieceCode} (${oldPiece.reason})`);
  const code = asText(event.body.piece_code);
  const failure = asText(event.body.failure_reason);
  if (code !== null) lines.push(failure === null ? `Piece: ${code}` : `Piece failed: ${code} (${failure})`);
  return lines;
}

/** The mandatory note on the transition that closes the job. */
async function closingNote(db: D1Database, job: JobForFsm, event: JobEvent): Promise<string> {
  const events = await eventsOf(db, job.id);
  const start = events.find((candidate) => candidate.kind === "start");
  const minutes = start === undefined ? null : Math.max(0, minutesBetween(start.occurredAt, event.occurredAt));
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

/**
 * What FSM's summary calls a consultation and fit in one visit, which FSM books on the first fit's item
 * (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
 */
const ONE_VISIT_NAME = "Consultation and fit";

/** Staging shares the real FSM org, so everything it writes says so (docs/open-points.md, item 19). */
const prefix = (deps: { labelAsTest: boolean }): string => (deps.labelAsTest ? "Staging test: " : "");

const indiaIsoOf = (instant: string): string => indiaIso(new Date(instant));

/** One field of an event's body, when the phone sent it as text; null otherwise. */
const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The piece that came off, as the piece step carries it; null when there was none. */
function asOldPiece(value: unknown): { pieceCode: string; reason: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const piece = value as { piece_code?: unknown; failure_reason?: unknown };
  const pieceCode = asText(piece.piece_code);
  const reason = asText(piece.failure_reason);
  return pieceCode === null || reason === null ? null : { pieceCode, reason };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** A line of a consumables step: by code, or by name from a phone that queued it before the codes. */
type UsedLine = { readonly quantity: number } & (
  { readonly code: string; readonly name: null } | { readonly code: null; readonly name: string }
);

function asItems(value: unknown): UsedLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): UsedLine[] => {
    const row = item as { code?: unknown; name?: unknown; quantity?: unknown };
    if (typeof row.quantity !== "number") return [];
    if (typeof row.code === "string") return [{ code: row.code, name: null, quantity: row.quantity }];
    return typeof row.name === "string" ? [{ code: null, name: row.name, quantity: row.quantity }] : [];
  });
}

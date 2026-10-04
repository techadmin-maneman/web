// What the dispatch board has in hand: a block already on a technician's day,
// or a job from the unassigned tray. The two are moved the same way and are
// written by the same two routes, so the board holds them under one type.

import type { Block, BoardClient, BookingWindow, BoardRow, Shown, Unassigned } from "../api.ts";
import { dispatch } from "../content.ts";

/** The three windows a day is booked in, in their order (src/config/scheduling.ts). */
export const WINDOWS: readonly BookingWindow[] = ["morning", "afternoon", "evening"];

export interface BlockJob {
  readonly kind: "block";
  readonly block: Block;
  readonly technician: BoardRow;
  readonly date: string;
}

export interface TrayJob {
  readonly kind: "unassigned";
  readonly job: Unassigned;
}

export type Job = BlockJob | TrayJob;

/** Where a job is being put: one technician's window on one day. */
export interface Target {
  readonly technician: BoardRow;
  readonly date: string;
  readonly window: BookingWindow;
}

export const idOf = (job: Job): string => (job.kind === "block" ? job.block.appointment_id : job.job.appointment_id);

/** The client the board writes on a block: "Rohit M.". */
export const clientOf = (job: Job): string | null => (job.kind === "block" ? job.block.client : job.job.client);

/** The client in full, with what reaches him; none for a visit with no client, or one erased. */
export const personOf = (job: Job): BoardClient | null => (job.kind === "block" ? job.block.person : job.job.person);

const typeOf = (job: Job) => (job.kind === "block" ? job.block.type : job.job.type);

/** The sector the job is in, which is as near an address as a block carries. */
const sectorOf = (job: Job): string | null => (job.kind === "block" ? job.block.sector : job.job.sector);

/**
 * What the board calls a job: the client on the block, or, where there is
 * none, the kind of visit and where it is.
 */
export function nameOf(job: Job): string {
  const client = clientOf(job);
  if (client !== null) return client;
  const type = typeOf(job);
  const parts = [type === null ? null : dispatch.typeNames[type], sectorOf(job)].filter(
    (part): part is string => typeof part === "string",
  );
  return parts.length === 0 ? dispatch.unnamed : parts.join(" · ");
}

/** The day and window a job stands in now, which the tray's jobs have as well. */
export function whenOf(job: Job): { readonly date: string | null; readonly window: BookingWindow | null } {
  if (job.kind === "block") return { date: job.date, window: job.block.window };
  return { date: job.job.date, window: job.job.offered_window };
}

/**
 * The job as the board shows it, which a move sends so a stale board is refused (FEO-05). A tray job still on a
 * technician who was switched off is his until it moves.
 */
export function shownOf(job: Job): Shown {
  if (job.kind === "block") return { technicianId: job.technician.technician_id, startsAt: job.block.starts_at };
  return { technicianId: job.job.was_technician?.id ?? null, startsAt: job.job.starts_at };
}

/** When the job starts now, on a technician's day or in the tray. */
export const startOf = (job: Job): string => (job.kind === "block" ? job.block.starts_at : job.job.starts_at);

/**
 * Whether a move to this target changes the job's time, which is what the client is told of: its start, where the
 * board knows where the move lands it, else its day or window.
 */
export function changesTime(job: Job, to: Target, landsAt: string | null = null): boolean {
  if (landsAt !== null) return Date.parse(landsAt) !== Date.parse(startOf(job));
  const was = whenOf(job);
  return was.date !== to.date || was.window !== to.window;
}

/** A visit done stays where it was worked, and one the technician has begun where he is working it. */
export const isMovable = (block: Block): boolean =>
  block.status !== "completed" && block.status !== "in_progress" && block.begun === null;

/** A visit the technician has checked in at and gone no further: it moves once ops choose to clear the check-in. */
export const movesIfCheckInCleared = (block: Block): boolean =>
  block.begun === "arrived" && (block.status === "scheduled" || block.status === "dispatched");

/** How far the technician has got on a visit not yet done, in the board's word; null before he arrives. */
export function begunWord(block: Block): string | null {
  if (block.begun === null || block.status === "completed") return null;
  return dispatch.board.begun[block.begun] ?? null;
}

/** What ops may do to a visit for its client from the board, besides moving it. */
export type VisitChange = "cancel" | "close";

const NOT_BEGUN: readonly Block["status"][] = ["scheduled", "dispatched"];
const OPEN: readonly Block["status"][] = ["scheduled", "dispatched", "in_progress"];

/**
 * Cancelled while it is still ahead and the technician has not begun it, or closed by hand once its time has come,
 * while neither his phone nor anyone has closed it.
 */
export function changeOf(block: Block, now: number): VisitChange | null {
  if (Date.parse(block.starts_at) > now) {
    return NOT_BEGUN.includes(block.status) && block.begun === null ? "cancel" : null;
  }
  return OPEN.includes(block.status) && block.begun !== "closed" ? "close" : null;
}

/** "Rohit", as the drawer's WhatsApp button names him. */
export const firstNameOf = (person: BoardClient): string => person.name.trim().split(/\s+/)[0] ?? person.name;

/** The India date `days` after `date`: the board's weeks are counted in whole days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

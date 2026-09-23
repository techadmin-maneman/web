// What the dispatch board has in hand: a block already on a technician's day,
// or a job from the unassigned tray. The two are moved the same way and are
// written by the same two routes, so the board holds them under one type.

import type { Block, BookingWindow, BoardRow, Unassigned } from "../api.ts";
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

/** The client the board writes on a block; the tray carries no client at all. */
export const clientOf = (job: Job): string | null => (job.kind === "block" ? job.block.client : null);

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

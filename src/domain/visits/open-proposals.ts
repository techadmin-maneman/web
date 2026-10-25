// A move proposal still open on a visit, as the client's app and the dispatch board read it
// (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md). Apart from ./move-proposals.ts, which moves
// visits, so the board can read proposals without loading the moves.

import { BOOKING_WINDOWS, type BookingWindow } from "../../config/scheduling.ts";
import { z } from "zod";
import { storedJson } from "../../lib/stored-json.ts";
import { windowTimesOf } from "../../policy/slot-times.ts";
import type { SlotSchedule } from "../booking/slot-times.ts";

/** A proposal still open on a visit, as the client's app and the dispatch board show it. */
export interface ProposedMove {
  readonly id: string;
  /** India's date, and the window, the visit would go to. */
  readonly date: string;
  readonly window: BookingWindow;
  /** The window's hours on that day, India's clock. */
  readonly hours: { readonly start: string; readonly end: string };
  readonly technician: { readonly name: string; readonly initials: string } | null;
  /** The last moment it may be accepted. */
  readonly expires_at: string;
}

/**
 * The visit's open proposal, as a JSON object, in a query of the visits whose row is named \`visit\`; null for none.
 * One the visit has moved since is not open: it names the start it was made against.
 */
export const openProposalJson = (visit: string): string => `(SELECT json_object('id', p.id, 'date', p.date,
    'window', p.window_label, 'technician_id', p.technician_id, 'technician_name', t.name,
    'technician_initials', t.initials, 'starts_at', p.starts_at, 'expires_at', p.expires_at)
  FROM move_proposals p LEFT JOIN technicians t ON t.id = p.technician_id
  WHERE p.appointment_id = ${visit}.id AND p.answered_at IS NULL AND p.expected_start = ${visit}.window_start)`;

/** What openProposalJson answers. */
const PROPOSAL = z.object({
  id: z.string(),
  date: z.string(),
  window: z.enum(BOOKING_WINDOWS),
  technician_id: z.string(),
  technician_name: z.string().nullable(),
  technician_initials: z.string().nullable(),
  starts_at: z.string().nullable(),
  expires_at: z.string(),
});

/** The open proposal openProposalJson read, while it may still be accepted; null for none. */
export function openProposalOf(json: string | null, now: Date, schedule: SlotSchedule): ProposedMove | null {
  if (json === null) return null;
  const read = storedJson(PROPOSAL, json, "openProposalJson");
  if (Date.parse(read.expires_at) <= now.getTime()) return null;
  return {
    id: read.id,
    date: read.date,
    window: read.window,
    hours: windowTimesOf(schedule.on(read.date))[read.window],
    technician:
      read.technician_name === null || read.technician_initials === null
        ? null
        : { name: read.technician_name, initials: read.technician_initials },
    expires_at: read.expires_at,
  };
}

/** An open proposal as the dispatch board places it: on its technician's row, at its start where it names one. */
export interface BoardProposedMove extends ProposedMove {
  readonly technician_id: string;
  /** The start proposed; null for one proposed as a window, before booking took starts. */
  readonly starts_at: string | null;
}

/** The open proposal openProposalJson read, as the dispatch board places it; null for none. */
export function boardProposalOf(json: string | null, now: Date, schedule: SlotSchedule): BoardProposedMove | null {
  const proposal = openProposalOf(json, now, schedule);
  if (json === null || proposal === null) return null;
  const read = storedJson(PROPOSAL, json, "openProposalJson");
  return { ...proposal, technician_id: read.technician_id, starts_at: read.starts_at };
}

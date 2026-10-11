// A move proposal still open on a visit, as the client's app and the dispatch board read it
// (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md). Apart from ./move-proposals.ts, which moves
// visits, so the board can read proposals without loading the moves.

import type { BookingWindow } from "../../config/scheduling.ts";

/** A proposal still open on a visit, as the client's app and the dispatch board show it. */
export interface ProposedMove {
  readonly id: string;
  /** India's date, and the window, the visit would go to. */
  readonly date: string;
  readonly window: BookingWindow;
  readonly technician: { readonly name: string; readonly initials: string } | null;
  /** The last moment it may be accepted. */
  readonly expires_at: string;
}

/**
 * The visit's open proposal, as a JSON object, in a query of the visits whose row is named \`visit\`; null for none.
 * One the visit has moved since is not open: it names the start it was made against.
 */
export const openProposalJson = (visit: string): string => `(SELECT json_object('id', p.id, 'date', p.date,
    'window', p.window_label, 'technician_name', t.name, 'technician_initials', t.initials, 'expires_at', p.expires_at)
  FROM move_proposals p LEFT JOIN technicians t ON t.id = p.technician_id
  WHERE p.appointment_id = ${visit}.id AND p.answered_at IS NULL AND p.expected_start = ${visit}.window_start)`;

interface ProposalJson {
  id: string;
  date: string;
  window: BookingWindow;
  technician_name: string | null;
  technician_initials: string | null;
  expires_at: string;
}

/** The open proposal openProposalJson read, while it may still be accepted; null for none. */
export function openProposalOf(json: string | null, now: Date): ProposedMove | null {
  if (json === null) return null;
  const read = JSON.parse(json) as ProposalJson;
  if (Date.parse(read.expires_at) <= now.getTime()) return null;
  return {
    id: read.id,
    date: read.date,
    window: read.window,
    technician:
      read.technician_name === null || read.technician_initials === null
        ? null
        : { name: read.technician_name, initials: read.technician_initials },
    expires_at: read.expires_at,
  };
}

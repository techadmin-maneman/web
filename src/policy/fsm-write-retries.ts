// A technician's step that FSM did not take. Only FSM refusing it gives it up. An outage, a timeout or our token
// waiting out Zoho's cool-down is waited out: the step is sent again until a day after it landed, and the steps
// behind it wait with it. A step given up on waits for ops, who send it again or enter it in FSM by hand.

import { DAY_MS } from "../lib/durations.ts";

/** How long after a step landed it is still sent again while FSM cannot be reached. */
export const OUTAGE_WAITED_MS = DAY_MS;

export interface FailedWrite {
  /** FSM refused the step itself, rather than failing to answer. */
  readonly refused: boolean;
  /** When the step landed, by our clock. */
  readonly landedAt: string;
}

/** Whether a step FSM did not take is given up on: FSM refused it, or a day has passed since it landed. */
export function givesUp(write: FailedWrite, now: Date): boolean {
  if (write.refused) return true;
  return now.getTime() - Date.parse(write.landedAt) >= OUTAGE_WAITED_MS;
}

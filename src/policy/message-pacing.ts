// How fast a long run of WhatsApps may leave our number. A launch's alerts leave in a paced line, and so do they when
// the sweeper sends them again, so that a hundred never leave in a second and cost us the number.

import { MINUTE_MS, SECOND_MS } from "../lib/durations.ts";

/** How many paced messages leave a minute. */
export const PACED_PER_MINUTE = 10;

/** The seconds from one paced message to the next. */
export const PACED_GAP_SECONDS = MINUTE_MS / SECOND_MS / PACED_PER_MINUTE;

/** How long to hold back the message at `position` in a line whose first message leaves `startSeconds` from now. */
export const pacedDelaySeconds = (startSeconds: number, position: number): number =>
  startSeconds + position * PACED_GAP_SECONDS;

// A number typed into a site form is proved with a WhatsApp code before the form acts on it: every booking from the
// site, which then signs the client into the app (docs/decisions/0285-every-site-booking-is-a-sign-in.md). The code is
// the login's: six digits, ten minutes, five tries (src/policy/one-time-code.ts).

import { MINUTE_MS } from "../lib/durations.ts";

/** How long an entered code keeps its number proved. */
const PROVED_FOR_MS = 30 * MINUTE_MS;

/** Whether a code entered at `verifiedAt` still proves its number. */
export function stillProved(verifiedAt: Date, now: Date): boolean {
  return now.getTime() - verifiedAt.getTime() < PROVED_FOR_MS;
}

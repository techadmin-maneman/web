// A number typed into a site form is proved with a WhatsApp code before the form acts on it. The code is the
// login's: six digits, ten minutes, five tries (src/policy/one-time-code.ts).

import { MINUTE_MS } from "../lib/durations.ts";
import type { Plan } from "./one-visit.ts";

/** How long an entered code keeps its number proved. */
const PROVED_FOR_MS = 30 * MINUTE_MS;

/** Whether booking this plan from the site needs the number proved. */
export function bookingNeedsProof(plan: Plan): boolean {
  return plan === "one_visit";
}

/** Whether a code entered at `verifiedAt` still proves its number. */
export function stillProved(verifiedAt: Date, now: Date): boolean {
  return now.getTime() - verifiedAt.getTime() < PROVED_FOR_MS;
}

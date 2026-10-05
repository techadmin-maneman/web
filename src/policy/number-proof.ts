// A number typed into a site form is proved with a WhatsApp code before the form acts on it. The code is the
// login's: six digits, ten minutes, five tries (src/policy/one-time-code.ts).

import { MINUTE_MS } from "../lib/durations.ts";
import type { Plan } from "./one-visit.ts";

export const RULES = [
  "The site books the consultation and fit in one visit, and the try-on sends its look, only to a number proved with the WhatsApp code sent to it.",
  "A number stays proved for 30 minutes after its code is entered, so a form refused for another reason can be sent again without a new code.",
  "The consultation alone and the waitlist do not ask for a code yet.",
] as const;

/** How long an entered code keeps its number proved (RULES[1]). */
const PROVED_FOR_MS = 30 * MINUTE_MS;

/** Whether booking this plan from the site needs the number proved (RULES[0], RULES[2]). */
export function bookingNeedsProof(plan: Plan): boolean {
  return plan === "one_visit";
}

/** Whether a code entered at `verifiedAt` still proves its number (RULES[1]). */
export function stillProved(verifiedAt: Date, now: Date): boolean {
  return now.getTime() - verifiedAt.getTime() < PROVED_FOR_MS;
}

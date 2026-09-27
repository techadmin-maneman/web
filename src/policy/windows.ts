// The client's three windows against the board's four slots (docs/prompts/phase2-backend.md, "Technician and dispatch rules, from the designs").
// The rule as the prompt states it. The mapping is WINDOW_SLOT_MAP in src/config/scheduling.ts
// (docs/decisions/0035-window-slot-map.md); here is which window a time of day falls in.

import { WINDOW_TIMES, type BookingWindow } from "../config/scheduling.ts";

export const RULES = [
  "The client app offers three windows (9–12, 12–4, 4–8). The dispatch board has four slots a day. Define the mapping in config WINDOW_SLOT_MAP and record it in an ADR. The two designs do not agree, so the mapping must be explicit, not guessed.",
] as const;

/** The window a time of day in India ("HH:MM") falls in. */
export function windowAt(time: string): BookingWindow {
  if (time < WINDOW_TIMES.afternoon.start) return "morning";
  if (time < WINDOW_TIMES.evening.start) return "afternoon";
  return "evening";
}

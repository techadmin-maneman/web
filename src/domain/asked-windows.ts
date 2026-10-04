// What the client asked for, as against what the board is offering them (docs/decisions/0063-the-asked-window.md).
// A visit is booked into the window the client picked, and a consultation keeps the window of their latest request as
// the one they asked for (src/domain/bookings.ts).

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";

/**
 * The window a Phase 1 booking's choice falls in: its two are morning and
 * evening (docs/decisions/0040-phase-1-alignment.md).
 */
export const askedWindowOf = (choice: VisitWindow): BookingWindow =>
  windowLabel(choice) === "before noon" ? "morning" : "evening";

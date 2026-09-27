// "Add to calendar": an .ics file for a booked consultation, made in the browser. The technician comes within the
// window, so the event covers the whole of it, in India's time as src/config/scheduling.ts gives it.

import { indiaInstant } from "@maneman/web-kit/dates";
import { WINDOW_TIMES, type BookingWindow } from "../../../src/config/scheduling.ts";

/** "2026-09-24" at "09:00" in India, as a calendar file's UTC time: 20260924T033000Z. */
function utcStamp(date: string, time: string): string {
  return indiaInstant(date, time)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** The calendar file for a consultation on `date` (YYYY-MM-DD) in `window`. */
export function consultationCalendar(date: string, window: BookingWindow, title: string, now: Date): string {
  const { start, end } = WINDOW_TIMES[window];
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mane Man//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // One consultation a number, so the day and window name it: a second download replaces the first.
    `UID:consultation-${date}-${window}@maneman.in`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${utcStamp(date, start)}`,
    `DTEND:${utcStamp(date, end)}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

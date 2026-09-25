// "Add to calendar": an .ics file for a booked consultation, made in the browser. The technician comes within the
// window, so the event covers the whole of it, in India's time as src/config/scheduling.ts gives it.

import { WINDOW_TIMES, type BookingWindow } from "../../../src/config/scheduling.ts";

/** India is five and a half hours ahead of UTC, all year. */
const INDIA_OFFSET_MINUTES = 330;

/** "2026-09-24" at "09:00" in India, as a calendar file's UTC time: 20260924T033000Z. */
function utcStamp(date: string, time: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hours, minutes - INDIA_OFFSET_MINUTES));
  return instant
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

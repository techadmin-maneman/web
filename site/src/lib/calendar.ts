// "Add to calendar": an .ics file for a booked consultation, made in the browser. The technician comes within the
// window, so the event covers the whole of it, in India's time as src/config/scheduling.ts gives it.

import { indiaInstant } from "@maneman/web-kit/dates";
import { WINDOW_TIMES, type BookingWindow } from "../../../src/config/scheduling.ts";

/** What the event says beyond its time and title. */
export interface CalendarDetails {
  /** The address typed; null where the visit goes to an address this page does not know. */
  readonly location: string | null;
  readonly description: string;
}

/** The longest line a calendar file should hold, in bytes, before it continues on the next (RFC 5545, 3.1). */
const LINE_BYTES = 75;

/** "2026-09-24" at "09:00" in India, as a calendar file's UTC time: 20260924T033000Z. */
function utcStamp(date: string, time: string): string {
  return indiaInstant(date, time)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** Text as a calendar file holds it: a backslash, a semicolon, a comma and a new line each escaped. */
function escaped(text: string): string {
  return text.replace(/[\\;,]/g, (character) => `\\${character}`).replace(/\r?\n/g, "\\n");
}

/** A long line split so no line passes LINE_BYTES; each continuation starts with a space. */
function folded(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  for (const character of line) {
    // A continuation's leading space counts towards its length.
    const room = lines.length === 0 ? LINE_BYTES : LINE_BYTES - 1;
    if (encoder.encode(current + character).length > room) {
      lines.push(current);
      current = "";
    }
    current += character;
  }
  lines.push(current);
  return lines.join("\r\n ");
}

/** The calendar file for a consultation on `date` (YYYY-MM-DD) in `window`. */
export function consultationCalendar(
  date: string,
  window: BookingWindow,
  title: string,
  now: Date,
  details: CalendarDetails,
): string {
  const { start, end } = WINDOW_TIMES[window];
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const location = details.location === null ? [] : [`LOCATION:${escaped(details.location)}`];
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
    `SUMMARY:${escaped(title)}`,
    ...location,
    `DESCRIPTION:${escaped(details.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(folded)
    .join("\r\n");
}

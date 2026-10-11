// A visit as an entry in the client's own calendar: a link that opens Google Calendar with it filled in, and an .ics
// file for Apple's, Outlook's and the rest. Times go in UTC, so a phone set to any zone shows India's hours.

export interface CalendarEntry {
  readonly title: string;
  readonly start: Date;
  readonly end: Date;
  readonly details: string;
  /** The same for the same visit, so a second file opened updates the entry rather than adding another. */
  readonly uid: string;
}

/** "20261013T063000Z". */
const stamp = (instant: Date): string => instant.toISOString().replace(/[-:]|\.\d{3}/g, "");

export function googleCalendarLink(entry: CalendarEntry): string {
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: entry.title,
    dates: `${stamp(entry.start)}/${stamp(entry.end)}`,
    details: entry.details,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

/** iCalendar's text: a backslash before each backslash, semicolon and comma, and each line break as \n. */
const icsText = (words: string): string => words.replace(/[\\;,]/g, (mark) => `\\${mark}`).replace(/\r?\n/g, "\\n");

/** A line cut every 75 bytes, as RFC 5545 asks, each part after the first opening with a space. */
function folded(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      parts.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += size;
  }
  parts.push(part);
  return parts.join("\r\n");
}

export function icsFile(entry: CalendarEntry, now: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mane Man//Visits//EN",
    "BEGIN:VEVENT",
    `UID:${entry.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(entry.start)}`,
    `DTEND:${stamp(entry.end)}`,
    `SUMMARY:${icsText(entry.title)}`,
    `DESCRIPTION:${icsText(entry.details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(folded).join("\r\n")}\r\n`;
}

/** The .ics file as a link's address, which a link with `download` saves and a phone offers to its calendar. */
export const icsHref = (entry: CalendarEntry, now: Date): string =>
  `data:text/calendar;charset=utf-8,${encodeURIComponent(icsFile(entry, now))}`;

// A visit in the client's calendar (src/lib/calendar.ts): Google's link and the .ics file, at India's hours.

import { describe, expect, it } from "vitest";
import { windowSpan } from "../../../src/config/scheduling.ts";
import { googleCalendarLink, icsFile, icsHref, type CalendarEntry } from "../../../src/lib/calendar.ts";

const afternoon = windowSpan("2026-10-13", "afternoon");
const entry: CalendarEntry = {
  title: "Mane Man consultation",
  ...afternoon,
  details: "Your technician arrives between 12 and 4 pm; it takes an hour.\nDetails on WhatsApp.",
  uid: "2026-10-13-afternoon@maneman.in",
};
const now = new Date("2026-10-11T00:15:00Z");

describe("a visit in the client's calendar", () => {
  it("spans the window at India's hours, whatever zone the phone is in", () => {
    expect(afternoon.start.toISOString()).toBe("2026-10-13T06:30:00.000Z");
    expect(afternoon.end.toISOString()).toBe("2026-10-13T10:30:00.000Z");
  });

  it("opens Google Calendar with the visit filled in", () => {
    const link = new URL(googleCalendarLink(entry));
    expect(link.origin + link.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(link.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Mane Man consultation",
      dates: "20261013T063000Z/20261013T103000Z",
      details: entry.details,
    });
  });

  it("writes an .ics file a calendar reads: escaped, lines of 75 bytes at most, ending in CRLF", () => {
    const file = icsFile(entry, now);
    const lines = file.split("\r\n");
    expect(lines.slice(0, 8)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Mane Man//Visits//EN",
      "BEGIN:VEVENT",
      "UID:2026-10-13-afternoon@maneman.in",
      "DTSTAMP:20261011T001500Z",
      "DTSTART:20261013T063000Z",
      "DTEND:20261013T103000Z",
    ]);
    expect(file.endsWith("END:VEVENT\r\nEND:VCALENDAR\r\n")).toBe(true);
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const unfolded = file.replace(/\r\n /g, "");
    expect(unfolded).toContain(
      "DESCRIPTION:Your technician arrives between 12 and 4 pm\\; it takes an hour.\\nDetails on WhatsApp.",
    );
  });

  it("cuts a long line between characters, never inside one", () => {
    const file = icsFile({ ...entry, details: "’".repeat(40) }, now);
    const description = file.split("\r\n").filter((line) => line.startsWith("DESCRIPTION:") || line.startsWith(" "));
    expect(description.map((line) => new TextEncoder().encode(line).length)).toEqual([75, 58]);
    expect(description.join("").replace(/^DESCRIPTION:| /g, "")).toBe("’".repeat(40));
  });

  it("gives the file as a link's address", () => {
    const href = icsHref(entry, now);
    expect(href.startsWith("data:text/calendar;charset=utf-8,BEGIN%3AVCALENDAR%0D%0A")).toBe(true);
    expect(decodeURIComponent(href.slice(href.indexOf(",") + 1))).toBe(icsFile(entry, now));
  });
});

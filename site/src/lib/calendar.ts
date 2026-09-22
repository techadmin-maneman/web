// "Add to calendar": an .ics file for the proposed visit, made in the browser.
// The hour is not fixed yet, so the event covers the whole window in India's
// time: 09:00–12:00 before noon, 16:00–20:00 after four.

const WINDOWS: Readonly<Record<string, readonly [string, string]>> = {
  // In UTC: India is 5 h 30 min ahead.
  "before noon": ["033000", "063000"],
  "after four": ["103000", "143000"],
};

/** The calendar file for a visit on `date` (YYYY-MM-DD) in the given window. */
export function consultationCalendar(date: string, windowLabel: string, id: string, now: Date): string {
  const [start, end] = WINDOWS[windowLabel] ?? WINDOWS["before noon"] ?? ["", ""];
  const day = date.replace(/-/g, "");
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
    `UID:${id}@maneman.in`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${day}T${start}Z`,
    `DTEND:${day}T${end}Z`,
    "SUMMARY:Mane Man consultation (time to be confirmed)",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

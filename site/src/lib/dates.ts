// The booking form's days, in India's calendar.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-09-21" as its parts. The date is a calendar day, so no time zone applies. */
function partsOf(date: string): { day: number; month: number; weekday: number } {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { day, month, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** Today in India, as a calendar date. The visitor's own clock may be anywhere. */
export function indiaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The first day a consultation can be booked: tomorrow in India. */
export function indiaTomorrow(now: Date = new Date()): string {
  return addDays(indiaToday(now), 1);
}

export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/** One day of the date strip: drawn "Sat" over "3", read out as "Saturday 3 October". */
export interface StripDay {
  readonly date: string;
  readonly weekday: string;
  readonly number: string;
  readonly month: string;
  readonly label: string;
}

/** The date strip: `days` days from `from` (board C2). */
export function dayStrip(from: string, days: number): StripDay[] {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    const { day, month, weekday } = partsOf(date);
    const monthName = MONTH_NAMES[month - 1] ?? "";
    return {
      date,
      weekday: SHORT_WEEKDAYS[weekday] ?? "",
      number: String(day),
      month: monthName,
      label: `${WEEKDAYS[weekday] ?? ""} ${String(day)} ${monthName}`,
    };
  });
}

/** The months above the strip: "October", or "October – November" where it crosses a month's end. */
export function stripMonths(days: readonly StripDay[]): string {
  const first = days[0]?.month ?? "";
  const last = days.at(-1)?.month ?? first;
  return first === last ? first : `${first} – ${last}`;
}

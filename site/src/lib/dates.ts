// The booked state's headline, built from the API's proposed date and window
// label: "Thursday, 24 September, before noon."

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
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

/** From "2026-09-24" and "before noon". The date is a calendar day, so no time zone applies. */
export function bookedHeadline(date: string, windowLabel: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  return `${weekday}, ${String(day)} ${MONTHS[month - 1] ?? ""}, ${windowLabel}.`;
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

/** The date strip: `days` days from `from`, each with its short weekday and day number (board C2). */
export function dayStrip(from: string, days: number): { date: string; weekday: string; number: string }[] {
  const short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(from, index);
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    return {
      date,
      weekday: short[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "",
      number: String(day),
    };
  });
}

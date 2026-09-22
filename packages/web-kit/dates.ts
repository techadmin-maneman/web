// Dates as the Phase 2 designs write them: "Sat 21 Sep", "22 Aug", "14 Nov 2026". A
// visit's date is a calendar date in India (YYYY-MM-DD); an instant, such as
// when a consent was given, is shown as India's date.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-09-24" → "Thu 24 Sep". */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return `${DAYS[date.getUTCDay()] ?? ""} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""}`;
}

/** "2027-08-22" → "22 Aug 2027". */
export function fullDate(isoDate: string): string {
  const [year = "", month, day] = isoDate.split("-");
  return `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

/** "2027-08-22" → "22 Aug" in 2027, and "22 Aug 2027" in any other year: as board E1 dates its entries. */
export function listDate(isoDate: string, thisYear: number): string {
  const full = fullDate(isoDate);
  return isoDate.startsWith(String(thisYear)) ? full.slice(0, full.lastIndexOf(" ")) : full;
}

/** An instant as India's calendar date, with the year: "2026-11-14T08:00:00Z" → "14 Nov 2026". */
export function longDate(isoInstant: string): string {
  // India is five and a half hours ahead of UTC, all year.
  const india = new Date(new Date(isoInstant).getTime() + 330 * 60 * 1000);
  return `${String(india.getUTCDate())} ${MONTHS[india.getUTCMonth()] ?? ""} ${String(india.getUTCFullYear())}`;
}

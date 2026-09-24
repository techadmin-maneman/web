// Dates as the Phase 2 designs write them: "Sat 21 Sep", "22 Aug", "14 Nov 2026". A
// visit's date is a calendar date in India (YYYY-MM-DD); an instant, such as
// when a consent was given, is shown as India's date.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
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
] as const;

/** "2026-09-24" → "Thu 24 Sep". */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return `${DAYS[date.getUTCDay()] ?? ""} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""}`;
}

/** "2026-09-24" → "Thursday 24 Sep", as board C3 heads the day. */
export function weekdayDate(isoDate: string): string {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return `${WEEKDAYS[day] ?? ""} ${shortDate(isoDate).slice(4)}`;
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

/** "2028-03" → "Mar 2028", as the ops board heads a client's replacement. */
export function shortMonth(isoMonth: string): string {
  const [year = "", month] = isoMonth.split("-");
  return `${MONTHS[Number(month) - 1] ?? ""} ${year}`;
}

/** "2028-03" → "March" in 2028, and "March 2028" in any other year: as listDate dates an entry. */
export function listMonth(isoMonth: string, thisYear: number): string {
  const [year = "", month] = isoMonth.split("-");
  const name = MONTH_NAMES[Number(month) - 1] ?? "";
  return year === String(thisYear) ? name : `${name} ${year}`;
}

/** An instant as India's calendar date, YYYY-MM-DD: "2026-09-21T20:00:00Z" → "2026-09-22". */
export function indiaDate(isoInstant: string): string {
  return new Date(new Date(isoInstant).getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** An instant as India's clock: "2026-09-22T03:44:00Z" → "9:14 am"; on the hour, "10 am". */
export function indiaClock(isoInstant: string): string {
  const india = new Date(new Date(isoInstant).getTime() + 330 * 60 * 1000);
  const hours = india.getUTCHours();
  const minutes = india.getUTCMinutes();
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour)}${minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`} ${hours < 12 ? "am" : "pm"}`;
}

/** An instant as India's calendar date, with the year: "2026-11-14T08:00:00Z" → "14 Nov 2026". */
export function longDate(isoInstant: string): string {
  // India is five and a half hours ahead of UTC, all year.
  const india = new Date(new Date(isoInstant).getTime() + 330 * 60 * 1000);
  return `${String(india.getUTCDate())} ${MONTHS[india.getUTCMonth()] ?? ""} ${String(india.getUTCFullYear())}`;
}

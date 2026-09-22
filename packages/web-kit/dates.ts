// Dates as the Phase 2 designs write them: "Sat 21 Sep". A visit's date is a
// calendar date in India (YYYY-MM-DD), so no time zone is involved.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-09-24" → "Thu 24 Sep". */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  return `${DAYS[date.getUTCDay()] ?? ""} ${String(date.getUTCDate())} ${MONTHS[date.getUTCMonth()] ?? ""}`;
}

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

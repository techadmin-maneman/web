// Today's words (../today/TodayScreen.tsx). Its homes take the words their figures already have where they are acted
// on; the day's sentence and each tile's line beneath its figure are Today's own.

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

/** How long something has waited: "38 min", "5 h", "3 days". */
function waited(minutes: number): string {
  if (minutes < 60) return `${String(Math.max(0, minutes))} min`;
  if (minutes < 24 * 60) return `${String(Math.floor(minutes / 60))} h`;
  return plural(Math.floor(minutes / (24 * 60)), "day", "days");
}

export const today = {
  tiles: {
    visits: "Visits today",
    unassigned: "Unassigned",
    overdue: "Overdue",
    open: "Open tasks",
    chats: "Chats to answer",
    lowStock: "Low stock",
    charges: "Charges to decide",
    upi: "UPI to record",
  },
  /** Above the title: the day, and the city the header is narrowed to. */
  day: (date: string, city: string) => `${date} · ${city}`,
  /** The title: a sentence on the day, by home. */
  greeting: {
    dispatch: (unassigned: number) =>
      unassigned === 0
        ? "Every visit today has a technician."
        : `${plural(unassigned, "visit needs", "visits need")} a technician.`,
    care: (waiting: number) =>
      waiting === 0
        ? "No one is waiting on a reply."
        : `${plural(waiting, "client is", "clients are")} waiting on a reply.`,
    city: (city: string | null, percent: number) =>
      city === null ? `${String(percent)}% booked today.` : `${city} is ${String(percent)}% booked today.`,
    finance: (collected: string) => `${collected} collected today.`,
  },
  /** A tile's line beneath its figure. */
  notes: {
    road: (done: number, underWay: number) => `${String(done)} done · ${String(underWay)} under way`,
    late: (technician: string, minutes: number) => `${technician}, ${waited(minutes)}`,
    oldest: (minutes: number) => `Oldest ${waited(minutes)}`,
    lastWeek: "Last 7 days",
    payments: (count: number) => plural(count, "payment", "payments"),
  },
  waited,
  road: {
    title: "On the road today",
    late: "Running late",
  },
  care: {
    median: "Median first reply",
    minutes: (minutes: number) => `${String(minutes)} min`,
    none: "—",
  },
  /** Yours first, then the rest of what waits, the longest overdue first. */
  needs: "Needs you",
  none: "Nothing waiting.",
  noPayments: "No payments yet today.",
  /** A side list's way to its page: "Open Dispatch". */
  openPage: (page: string) => `Open ${page}`,
};

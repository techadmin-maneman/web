// Today's words (../today/TodayScreen.tsx).

export const today = {
  tiles: {
    visits: "Visits today",
    unassigned: "Unassigned",
    overdue: "Overdue",
    open: "Open tasks",
    chats: "Unanswered chats",
    lowStock: "Low stock",
    charges: "Charges to decide",
    upi: "UPI to record",
  },
  /** Beside the title: the day it is. */
  day: (date: string) => date,
  /** A part of the day for each kind of work, shown to whoever's access reaches it. */
  road: {
    title: "On the road today",
    done: "Done",
    underWay: "Under way",
    late: "Running late",
    toCome: "Still to come",
  },
  care: {
    title: "Care, the last week",
    median: "Median first reply",
    onTime: "Answered on time",
    minutes: (minutes: number) => `${String(minutes)} min`,
    percent: (percent: number) => `${String(percent)}%`,
    none: "—",
  },
  growth: {
    title: "Growth, the last 30 days",
    leads: "New clients",
    fitted: "Fitted",
  },
  /** Yours first, then the rest of what waits, the longest overdue first. */
  needs: "Needs you",
  none: "Nothing waiting.",
  who: "Who",
  what: "What",
  due: "Due",
};

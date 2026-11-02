// Today's words (../today/TodayScreen.tsx). Its homes take the words their figures already have where they are acted
// on; a slot the redesign added with none holds TODO_COPY (design/ops-redesign/COPY-TODO.md).

import { TODO_COPY } from "./common.ts";
import { DEPARTMENT_NAMES, shell } from "./shell.ts";

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
  /** Beside the title: the day it is, and the city the header is narrowed to. */
  day: (date: string, city: string) => `${date} · ${city}`,
  /** A sentence on the day beneath the title, drawn once it is worded. */
  greeting: TODO_COPY,
  /** The homes Today opens on, by the person's grants (ADR 0227), and the choice between them. */
  homes: {
    label: shell.nav.today,
    names: {
      dispatch: shell.nav.dispatch,
      care: DEPARTMENT_NAMES.customer_care,
      // The brief's own words, to confirm (design/ops-redesign/COPY-TODO.md).
      city: "City head",
      finance: DEPARTMENT_NAMES.finance,
      inventory: shell.nav.inventory,
    },
  },
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
  /** The homes' own lists with nothing in them, where nothing on the console says so yet. */
  noPayments: TODO_COPY,
  noPlaces: TODO_COPY,
};

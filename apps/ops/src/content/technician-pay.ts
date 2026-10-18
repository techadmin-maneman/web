// The Technician pay page's words (Finance; docs/decisions/0122-technician-pay-per-visit.md). The page imports them
// itself, so they stay out of the console's first load.

import { fullMonth } from "@maneman/web-kit/dates";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const technicianPay = {
  /** The rate refused, with the most a visit may pay. */
  amountUpTo: (most: string) => `Enter whole rupees, up to ${most} a visit.`,
  kinds: {
    consultation: "Consultation",
    one_visit: "Consultation and fit",
    first_fit: "First fit",
    service: "Service visit",
    replacement: "Replacement",
    no_show: "No-show",
  },
  rates: {
    title: "Rates per visit",
    city: "City",
    everyCity: "Every city",
    addGrade: "Add grade",
    none: "No grades yet.",
    grade: "Grade",
    technicians: "Technicians",
    /** A row's name, read as what pressing it does. */
    open: (grade: string) => `Open ${grade}`,
    empty: "—",
    /** A city's cell with no rate of its own: every city's stands in. */
    inherited: (amount: string) => `${amount} (every city)`,
    later: (amount: string, date: string) => `${amount} from ${date}`,
    laterNone: (date: string) => `None from ${date}`,
    inUse: "In use: a technician holds it, or a rate names it.",
  },
  technicians: {
    title: "Technicians",
    none: "No technicians.",
    name: "Technician",
    city: "City",
    grade: "Grade",
    noCity: "No city",
    /** A technician with no grade is paid nothing for their visits until they have one. */
    noGrade: "No grade, so not paid",
    /** A row's name, read as what pressing it does. */
    open: (name: string) => `Open ${name}`,
  },
  form: {
    addTitle: "New grade",
    name: "Name",
    /** The heading over a grade's rates in its record: "Rates in Delhi", "Rates in every city". */
    ratesIn: (city: string | null) => (city === null ? "Rates in every city" : `Rates in ${city}`),
    from: "Starts",
    add: "Add",
    cancel: "Cancel",
  },
  /** The month's pay at the rates per visit, with its CSV. */
  statement: {
    title: "Pay for the month",
    month: "Month",
    monthName: (month: string) => fullMonth(month),
    none: "No visits closed that month.",
    download: "Download CSV",
    fileName: (month: string) => `technician-pay-${month}.csv`,
    columns: ["Technician", "City", "Visit", "Visits", "Rate", "Amount"],
    noCity: "No city",
    noRate: "No rate",
    total: (name: string) => `${name}: total`,
    totalUnpriced: (name: string) => `${name}: total, without the visits no rate covers`,
  },
  done: { saved: "Saved.", deleted: "Grade deleted." },
  errors: {
    name: "Up to 40 letters or digits.",
    taken: "A grade has that name.",
    in_use: "In use: a technician holds it, or a rate names it.",
    from: "A rate starts today or later.",
    city: "Choose one of our cities.",
    amount: "Enter whole rupees.",
    not_found: changed("Already gone."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};

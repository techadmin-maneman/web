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
    addGrade: "Add a grade",
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
    /** Every rate a grade was given, in its record beneath the rates now. */
    history: {
      title: "Every rate set",
      from: "From",
      kind: "Visit",
      city: "City",
      amount: "Rate",
      everyCity: "Every city",
      none: "None",
    },
    inUse: "In use: a technician holds it, or a rate names it.",
  },
  technicians: {
    find: "Find a technician",
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
  /** A technician's grade from a day, and the grades they were given before. */
  grading: {
    grade: "Grade",
    from: "Starts",
    none: "No grade",
    notPaid: "No grade, so not paid",
    later: (grade: string, date: string) => `${grade} from ${date}`,
    fromToday: "A grade starts today or later.",
    /** The grade every technician held before grades had a start day. */
    always: "From the start",
    history: {
      title: "Grades",
      from: "From",
      setBy: "Set",
      setOn: (who: string, day: string) => `${who}, ${day}`,
    },
  },
  form: {
    addTitle: "Add a grade",
    name: "Name",
    /** The heading over a grade's rates in its record: "Rates in Delhi", "Rates in every city". */
    ratesIn: (city: string | null) => (city === null ? "Rates in every city" : `Rates in ${city}`),
    from: "Starts",
    add: "Add",
  },
  /** The month's pay at the rates per visit, with its CSV. */
  statement: {
    title: "Pay for the month",
    month: "Month",
    monthName: (month: string) => fullMonth(month),
    none: "No visits closed that month.",
    download: "Download CSV",
    fileName: (month: string) => `technician-pay-${month}.csv`,
    /** The CSV's columns, a line each by city and rate, as payroll reads them. */
    columns: ["Technician", "City", "Visit", "Visits", "Rate", "Amount"],
    noCity: "No city",
    /** Beside the page's title: the month shown, and whether it is still running. */
    monthHead: (month: string, current: boolean) => (current ? `${fullMonth(month)}, so far` : fullMonth(month)),
    /** The table's columns, a row each technician, as the redesign draws them. */
    technician: "Technician",
    grade: "Grade",
    amount: "Amount",
    kindHeads: {
      consultation: "Consultations",
      one_visit: "Consultations and fits",
      first_fit: "First fits",
      service: "Service visits",
      replacement: "Replacements",
      no_show: "No-shows",
    },
    /** Beneath an amount, where a visit had no rate: the amount leaves it out. */
    unpriced: "Some visits have no rate",
    /** A technician's name opens their lines, by city and rate, as the CSV has them. */
    openLabel: (name: string) => `Open ${name}’s pay by visit`,
    lineColumns: ["City", "Visit", "Visits", "Rate", "Amount"],
    noRate: "No rate",
    totalOf: (count: number) => `${String(count)} ${count === 1 ? "technician" : "technicians"}`,
    /** Above the month: those with no grade, whose visits are not paid. */
    ungraded: (names: readonly string[]) =>
      names.length === 1
        ? `${names[0] ?? ""} has no pay grade and isn’t being paid.`
        : `${String(names.length)} technicians have no pay grade and aren’t being paid.`,
    setGrades: "Set pay grades",
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

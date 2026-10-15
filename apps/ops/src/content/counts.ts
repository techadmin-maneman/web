// Operations · Counts (docs/decisions/0185-cycle-counts.md). No design draws it; every word here is ours. Only the
// Counts page reads it, loaded when it opens.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const counts = {
  title: "Counts",
  tasks: "Count tasks",
  none: "Nothing to count today.",
  columns: ["Place", "Class", "Due", "Status", ""],
  classes: { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" },
  states: {
    open: "To count",
    recount: "To count again",
    sign_off: "Waiting for sign-off",
    done: "Done",
  },
  open: "Open",
  /** "Imran Qureshi · Weekly" */
  heading: (place: string, countClass: string) => `${place} · ${countClass}`,
  countNote: "Count what’s there.",
  recountNote: "These differed. Count them again.",
  counted: (name: string) => `Count of ${name}`,
  /** A hair system held under labels: each one scanned, and any with no label counted beside them. */
  scanEach: (name: string) => `Scan every ${name} here.`,
  unlabelled: (name: string) => `${name} with no label`,
  /** "Not held here: MM-ESS-0000041-R. Look into it." */
  notHeld: (labels: readonly string[]) =>
    `Not held here: ${labels.join(", ")}. Look into ${labels.length === 1 ? "it" : "them"}.`,
  notScanned: (labels: readonly string[]) => `Not scanned: ${labels.join(", ")}.`,
  saveCount: "Save count",
  saveRecount: "Save recount",
  countSaid: (waiting: number) => (waiting === 0 ? "Counted." : `Counted. ${String(waiting)} to count again.`),
  recountSaid: (waiting: number) =>
    waiting === 0 ? "Counted again. All settled." : `Counted again. ${String(waiting)} wait for sign-off.`,
  differencesColumns: ["Item", "Held", "Counted", "Recounted"],
  why: "Why it differs",
  signOff: "Sign off",
  signedSaid: "Signed off.",
  waiting: "Waiting for a manager’s sign-off.",
  done: "Done.",
  classesTitle: "Count classes",
  /** "Default · Weekly" */
  ownClass: (countClass: string) => `Default · ${countClass}`,
  classSaid: "Class saved.",
  startTitle: "Count now",
  place: "Place",
  item: "Item",
  choose: "Choose",
  start: "Start count",
  errors: {
    lines: changed("The items changed since this opened."),
    labels: "Scan each labelled piece once.",
    counted: "That’s fewer than the labels scanned.",
    consumable_code: "This place holds none of that.",
    order_state: changed("Someone else counted this first."),
    not_found: changed("That’s gone."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};

// Operations · Counts (docs/decisions/0185-cycle-counts.md). No design draws it; every word here is ours. Only the
// Counts page reads it, loaded when it opens.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const counts = {
  title: "Counts",
  tasks: "Count tasks",
  none: "Nothing to count. Tasks come round each morning.",
  columns: ["Place", "Class", "Due", "Stands", ""],
  classes: { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly" } as Readonly<Record<string, string>>,
  states: {
    open: "To count",
    recount: "To count again",
    sign_off: "Waiting for sign-off",
    done: "Done",
  } as Readonly<Record<string, string>>,
  open: "Open",
  /** "Imran Qureshi · Weekly" */
  heading: (place: string, countClass: string) => `${place} · ${countClass}`,
  countNote: "Count what is there.",
  recountNote: "These differed. Count them again.",
  counted: (name: string) => `Count of ${name}`,
  saveCount: "Save count",
  saveRecount: "Save recount",
  countSaid: (waiting: number) => (waiting === 0 ? "Counted." : `Counted. ${String(waiting)} to count again.`),
  recountSaid: (waiting: number) =>
    waiting === 0 ? "Counted again. All settled." : `Counted again. ${String(waiting)} wait for sign-off.`,
  differencesColumns: ["Item", "Held", "Counted", "Recounted"],
  why: "Why it differs",
  signOff: "Sign off",
  signedSaid: "Signed off.",
  waiting: "Waiting for a manager's sign-off.",
  done: "Done.",
  classesTitle: "Count classes",
  classesNote: "Hair systems are counted weekly and the rest quarterly, unless set here.",
  classColumns: ["Item", "Class"],
  classLabel: (name: string) => `Count class of ${name}`,
  /** "Default · Weekly" */
  ownClass: (countClass: string) => `Default · ${countClass}`,
  classSaid: "Class saved.",
  errors: {
    lines: "The items changed since this opened. Reload.",
    order_state: "Someone else counted this first. Reload.",
    not_found: "That is gone. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
};

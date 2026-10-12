// Operations · Quality (docs/decisions/0187-recalls.md). No design draws it; every word here is ours. Only the Quality
// page reads it, loaded when it opens.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const quality = {
  title: "Quality",
  recalls: "Recalls",
  none: "No recalls.",
  columns: ["Recall", "Item", "Lot", "Raised", "Stands", ""],
  /** "RC-0003" */
  number: (number: number) => `RC-${String(number).padStart(4, "0")}`,
  open: "Open",
  closed: "Closed",
  view: (number: string) => `Open ${number}`,
  viewShort: "Open",
  raise: "Recall a lot",
  lot: "Lot",
  /** "Essential 8x10 · BAD-0921" */
  lotLabel: (name: string, lotCode: string) => `${name} · ${lotCode}`,
  reason: "Why it is recalled",
  confirmRaise: "Recall it",
  raisedSaid: "Recalled. Its pieces are kept from fits and each client's is due now.",
  held: "Where it is",
  heldColumns: ["Place", "Quantity"],
  noneHeld: "None held anywhere.",
  worn: "Who wears it",
  wornColumns: ["Client", "Piece", "Due"],
  noneWorn: "No client wears it.",
  close: "Close recall",
  closedSaid: "Closed. The lot stays blocked.",
  errors: {
    lot_id: "That lot is recalled already, or gone. Reload.",
    not_found: "That recall is gone or closed. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
};

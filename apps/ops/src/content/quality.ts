// Operations · Quality (docs/decisions/0187-recalls.md). No design draws it; every word here is ours. Only the Quality
// page reads it, loaded when it opens.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const quality = {
  title: "Quality",
  recalls: "Recalls",
  none: "No recalls.",
  columns: ["Recall", "Item", "Lot", "Raised", "Status", ""],
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
  reason: "Reason",
  confirmRaise: "Recall it",
  raisedSaid: "Recalled. Its pieces are blocked, and their wearers are due a replacement.",
  held: "Where it is",
  heldColumns: ["Place", "Quantity"],
  noneHeld: "None held anywhere.",
  worn: "Who wears it",
  wornColumns: ["Client", "Piece", "Due", ""],
  /** A worn piece's replacement, booked at no charge; the button's whole name says whose. */
  bookFree: "Book, free",
  bookFreeLabel: (person: string) => `Book ${person}’s replacement, free`,
  noneWorn: "No client wears it.",
  close: "Close recall",
  closedSaid: "Closed. The lot stays blocked.",
  failures: "Failure rates",
  failuresPeriod: "Last 12 months",
  noFailures: "No pieces fitted from labelled stock yet.",
  failuresBy: "Group by",
  ways: { code: "Stock code", lot: "Lot", supplier: "Supplier", technician: "Technician" },
  failureColumns: ["", "Fitted", "Failed", "Rate"],
  /** "12.5%", or a dash */
  rate: (percent: number | null) => (percent === null ? "—" : `${String(percent)}%`),
  risk: "Value at risk",
  findLot: "Find a lot, item or place",
  /** "Rs. 1,234 will expire before it is used." */
  riskTotal: (value: string) => `${value} will expire before it is used.`,
  noRisk: "Everything held will be used before it expires.",
  riskColumns: ["Place", "Item", "Lot", "Expires", "Left over", "Value", "Actions"],
  suggestions: {
    write_off: "Write off",
    use_first: "Use first",
    /** A move with nowhere named to take it. */
    move: "Move elsewhere",
  },
  /** "Move to Imran Qureshi" */
  moveTo: (place: string) => `Move to ${place}`,
  errors: {
    lot_id: changed("That lot is recalled already, or gone."),
    not_found: changed("That recall is gone or closed."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};

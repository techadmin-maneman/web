// Operations · Quality (docs/decisions/0187-recalls.md). No design draws it; every word here is ours. Only the Quality
// page reads it, loaded when it opens.

import { FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

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
  wornColumns: ["Client", "Piece", "Due", ""],
  /** A worn piece's replacement, booked at no charge; the button's whole name says whose. */
  bookFree: "Book, free",
  bookFreeLabel: (person: string) => `Book ${person}'s replacement, free`,
  noneWorn: "No client wears it.",
  close: "Close recall",
  closedSaid: "Closed. The lot stays blocked.",
  failures: "Failure rates",
  failuresNote: "Pieces fitted from labelled stock in the last year, and how many failed.",
  noFailures: "No pieces fitted from labelled stock yet.",
  failuresBy: "Group by",
  ways: { code: "Stock code", lot: "Lot", supplier: "Supplier", technician: "Technician" } as Readonly<
    Record<string, string>
  >,
  failureColumns: ["", "Fitted", "Failed", "Rate"],
  /** "12.5%", or a dash */
  rate: (percent: number | null) => (percent === null ? "—" : `${String(percent)}%`),
  risk: "Value at risk",
  /** "Rs. 3,350 will expire before it is used." */
  riskTotal: (value: string) => `${value} will expire before it is used.`,
  noRisk: "Everything held will be used before it expires.",
  riskColumns: ["Place", "Item", "Lot", "Expires", "Left over", "Value", "Do"],
  suggestions: {
    write_off: "Write off",
    use_first: "Use first",
  } as Readonly<Record<string, string>>,
  /** "Move to Imran Qureshi" */
  moveTo: (place: string) => `Move to ${place}`,
  errors: {
    lot_id: "That lot is recalled already, or gone. Reload.",
    not_found: "That recall is gone or closed. Reload.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
};

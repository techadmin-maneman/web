// The Stock page's In transit panel (docs/decisions/0158-transfers-in-transit.md). No design draws it; every word here
// is ours. Only the panel reads it, and it loads only while something is on its way.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

export const stockTransit = {
  title: "In transit",
  columns: ["Item", "How many", "From", "To", "Sent", ""],
  receive: "Receive",
  receiveLabel: (what: string, to: string) => `Receive ${what} at ${to}`,
  sendBack: "Send back",
  sendBackLabel: (what: string, from: string) => `Send ${what} back to ${from}`,
  arrived: "Arrived",
  note: "Note (optional)",
  confirm: "Record",
  cancel: "Cancel",
  short: (lost: number, unit: string) => `${String(lost)} ${unit} lost on the way.`,
  errors: {
    received: "More arrived than was sent. Check the figure.",
    units: "A label scanned wasn’t on this transfer.",
    transfer_settled: changed("Already received or sent back."),
    not_found: changed("That transfer is gone."),
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
};

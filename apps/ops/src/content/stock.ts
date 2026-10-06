// Stock: what each place holds, and a delivery, transfer, count or write-off recorded.

import { NOT_PERMITTED } from "./common.ts";

/**
 * Every word of Stock. Stock is kept in our own ledger, per technician's
 * kit and a central store (docs/decisions/0087-consumables-and-stock.md).
 */
export const stock = {
  title: "Stock",
  sub: "What each kit and the central store hold. A job's use comes out of its technician's kit as he records it.",
  onHand: "On hand",
  central: "Central store",
  /** A technician who has left, whose kit still holds stock. */
  left: (name: string) => `${name} (left)`,
  consumable: "Consumable",
  /** "12 strip", and a mark for a place at or below its level. */
  held: (quantity: number, unit: string) => `${String(quantity)} ${unit}`,
  low: "Low",
  /** Each followed by a link to Settings, Consumables. */
  lowNote: "Low: at or below the level set for the consumable in",
  none: "No consumables yet. Add them in",
  settings: "Settings, Consumables",
  retired: "retired",
  counted: (when: string) => `Counted ${when}`,
  record: {
    title: "Record a movement",
    what: "What happened",
    kinds: {
      delivery: "A delivery into the central store",
      transfer: "A transfer",
      count: "A count",
      write_off: "A loss",
    } as Readonly<Record<string, string>>,
    consumable: "Consumable",
    quantity: "How many",
    quantityHint: (unit: string, max: number) => `In ${unit}, a whole number up to ${String(max)}.`,
    from: "From",
    to: "To",
    place: "Where",
    counted: "How many were counted",
    note: "Note",
    noteHint: "The supplier's note, or what happened. No client's name.",
    lossNote: "What was lost, and how",
    check: "Check it",
  },
  confirm: {
    // What the movement does to each place, the old beside the new.
    title: "Check the movement",
    line: (place: string, was: string, now: string) => `${place}: ${was} → ${now}`,
    below: (place: string) =>
      `${place} would hold less than nothing: record the delivery or the count that is missing.`,
    same: "A count that agrees records only that it was counted.",
    send: "Record it",
    back: "Change it",
  },
  recorded: "Recorded.",
  movements: {
    title: "Latest movements",
    columns: ["When", "Consumable", "Where", "Change", "Why", "Who"],
    reasons: {
      received: "Delivered",
      transferred: "Transfer",
      used: "Used on a job",
      counted: "Count",
      written_off: "Loss",
    } as Readonly<Record<string, string>>,
    none: "Nothing has moved yet.",
    change: (quantity: number) => (quantity > 0 ? `+${String(quantity)}` : String(quantity)),
  },
  /** A refusal, said of the box it names (src/routes/ops/stock.ts). */
  errors: {
    not_permitted: NOT_PERMITTED,
    consumable_code: "That consumable is not in the list any more. Reload the page.",
    from: "That kit is not one we know. Reload the page.",
    to: "Stock moves from one place to another, not to the place it is in. Nothing was recorded.",
    technician_id: "That kit is not one we know. Reload the page.",
    note: "Say what happened, in up to 200 characters. Nothing was recorded.",
    offline: "You are offline. Connect, then try again.",
    unknown: "That did not go through. Nothing was recorded.",
  } as Readonly<Record<string, string>>,
} as const;

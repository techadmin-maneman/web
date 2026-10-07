// Stock: what each place holds, and a delivery, transfer, count or write-off recorded.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

/**
 * Every word of Stock. Stock is kept in our own ledger, per technician's
 * kit and a central store (docs/decisions/0087-consumables-and-stock.md).
 */
export const stock = {
  title: "Stock",
  sub: "What each kit and the central store hold. Use on a job comes out of the technician's kit.",
  onHand: "On hand",
  central: "Central store",
  /** A technician who has left, whose kit still holds stock. */
  left: (name: string) => `${name} (left)`,
  consumable: "Consumable",
  /** "12 strip", and a mark for a place at or below its level. */
  held: (quantity: number, unit: string) => `${String(quantity)} ${unit}`,
  low: "Low",
  /** Each followed by a link to Settings, Consumables. */
  lowNote: "Low means at or below the level set in",
  none: "No consumables yet. Add them in",
  settings: "Settings, Consumables",
  retired: "retired",
  counted: (when: string) => `Counted ${when}`,
  record: {
    title: "Record a movement",
    what: "What happened",
    kinds: {
      delivery: "Delivery to the central store",
      transfer: "Transfer",
      count: "Count",
      write_off: "Loss",
    } as Readonly<Record<string, string>>,
    consumable: "Consumable",
    quantity: "How many",
    quantityHint: (unit: string, max: number) => `In ${unit}, up to ${String(max)}.`,
    from: "From",
    to: "To",
    place: "Where",
    counted: "Counted",
    note: "Note",
    noteHint: "Supplier note, or what happened. No client names.",
    lossNote: "What was lost, and how",
    check: "Review",
  },
  confirm: {
    // What the movement does to each place, the old beside the new.
    title: "Review the movement",
    line: (place: string, was: string, now: string) => `${place}: ${was} → ${now}`,
    below: (place: string) => `${place} would go below zero. Record the missing delivery or count first.`,
    same: "Matches what's held. Records the count only.",
    send: "Record",
    back: "Edit",
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
    none: "No movements yet.",
    change: (quantity: number) => (quantity > 0 ? `+${String(quantity)}` : String(quantity)),
  },
  /** A refusal, said of the box it names (src/routes/ops/stock.ts). */
  errors: {
    not_permitted: NOT_PERMITTED,
    consumable_code: "That consumable is no longer listed. Reload.",
    from: "Unknown kit. Reload.",
    to: "From and to must be different places.",
    technician_id: "Unknown kit. Reload.",
    note: "Say what happened, in up to 200 characters.",
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
} as const;

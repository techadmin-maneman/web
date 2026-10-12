// Stock: what each place holds, and a delivery, transfer, count or write-off recorded.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

/**
 * Every word of Stock. Stock is kept in our own ledger, per place: the warehouse, hubs, stockrooms and each
 * technician's kit (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md).
 */
export const stock = {
  title: "Stock",
  onHand: "On hand",
  /** A technician who has left, whose kit still holds stock. */
  left: (name: string) => `${name} (left)`,
  /** A hub or a stockroom closed while it still holds stock. */
  closed: (name: string) => `${name} (closed)`,
  consumable: "Consumable",
  // Not drawn: past a handful of places, the one shown beside the warehouse, and a place low on anything.
  place: "Place",
  placeLow: " · low",
  totalsBy: "Show",
  byPlace: "Each place",
  byZone: "Totals by zone",
  byCity: "Totals by city",
  /** "12 strip", and a mark for a place at or below its level. */
  held: (quantity: number, unit: string) => `${String(quantity)} ${unit}`,
  low: "Low",
  none: "No consumables yet. Add them in",
  settings: "Settings, Consumables",
  retired: "retired",
  counted: (when: string) => `Counted ${when}`,
  /** The soonest a lot held there expires. */
  expires: (when: string) => `Expires ${when}`,
  record: {
    title: "Record a movement",
    what: "What happened",
    kinds: {
      delivery: "Delivery to the warehouse",
      transfer: "Transfer",
      count: "Count",
      write_off: "Loss",
    } as Readonly<Record<string, string>>,
    consumable: "Consumable",
    quantity: "How many",
    /** "How many (ml)": the unit beside the label, where the field takes a figure in it. */
    inUnit: (label: string, unit: string) => (unit === "" ? label : `${label} (${unit})`),
    from: "From",
    to: "To",
    place: "Where",
    counted: "Counted",
    note: "Note",
    lossNote: "What was lost, and how",
    lot: "Supplier lot (optional)",
    expires: "Expires (optional)",
    lostLot: "Lot",
    soonest: "Soonest to expire",
    /** "SV-2611 · expires 30 Nov" */
    lotLine: (lot: string, expires: string | null) => (expires === null ? lot : `${lot} · expires ${expires}`),
    check: "Review",
  },
  confirm: {
    // What the movement does to each place, the old beside the new.
    title: "Review the movement",
    line: (place: string, was: string, now: string) => `${place}: ${was} → ${now}`,
    below: (place: string) => `${place} would go below zero.`,
    same: "Matches what's held. Records the count only.",
    send: "Record",
    back: "Edit",
  },
  recorded: "Recorded.",
  movements: {
    title: "Latest movements",
    narrow: "Filter movements",
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
    from: "Unknown place. Reload.",
    to: "From and to must be different places.",
    place_id: "Unknown place. Reload.",
    lot_id: "That lot isn't held there. Reload.",
    units: "A label scanned isn't held there. Check the pieces.",
    quantity: "One delivery labels at most 500 pieces.",
    note: "Say what happened, in up to 200 characters.",
    offline: OFFLINE,
    unknown: FAILED,
  } as Readonly<Record<string, string>>,
} as const;

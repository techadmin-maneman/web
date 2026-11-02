// Stock: what each place holds, and a delivery, transfer, count or write-off recorded.

import { amountOf } from "@maneman/web-kit/figures";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

/**
 * Every word of Stock. Stock is kept in our own ledger, per place: the warehouse, hubs, stockrooms and each
 * technician's kit (docs/decisions/0087-consumables-and-stock.md, 0155-the-stock-place-tree.md).
 */
export const stock = {
  title: "Stock",
  onHand: "On hand",
  /** The page's views, a tab each, so no one scrolls past six panels to the one they came for. */
  views: {
    names: { "on-hand": "On hand", expiring: "Expiring", movements: "Movements", labels: "Labels", places: "Places" },
  },
  /** A technician who has left, whose kit still holds stock. */
  left: (name: string) => `${name} (left)`,
  /** A hub or a stockroom closed while it still holds stock. */
  closed: (name: string) => `${name} (closed)`,
  consumable: "Item",
  place: "Place",
  /** In a list of places, the kits of technicians who left and the places closed, still holding stock. */
  noLongerInUse: "No longer in use",
  /** A place whose name another shares, told apart by its city. */
  inCity: (name: string, city: string) => `${name} (${city})`,
  /** Above On hand, each place with something below zero, out or low, and how many items; its name shows it. */
  attention: {
    title: "Needs attention",
    columns: ["Items below zero", "Items out", "Items low"],
    /** Beneath a place's name: "4 below zero · 5 out · 2 low", what it has none of left out. */
    counts: (below: number, out: number, low: number) =>
      [
        ...(below === 0 ? [] : [`${String(below)} below zero`]),
        ...(out === 0 ? [] : [`${String(out)} out`]),
        ...(low === 0 ? [] : [`${String(low)} low`]),
      ].join(" · "),
  },
  /** A place's items narrowed: every one, those low or out, or those with a lot expiring soon; and found by name. */
  narrow: {
    label: "Narrow the items",
    all: "All items",
    short: "Low or out",
    expiring: "Expiring soon",
    find: "Find an item",
    none: "No item matches.",
  },
  totalsBy: "Show",
  /** With a handful of places, every one side by side. */
  allPlaces: "All places",
  byZone: "Totals by zone",
  byCity: "Totals by city",
  /** "12 strips", and a mark for a place at or below its level. */
  held: (quantity: number, unit: string) => amountOf(quantity, unit),
  /** At or under the item's level for that kind of place. */
  low: "Low",
  /** None left. */
  out: "Out",
  /** Less than nothing: a movement went unrecorded, and a count puts it right. */
  belowZero: "Below zero",
  none: "No consumables yet. Add them in",
  retired: "retired",
  /** One place's columns: what it holds and its state, the soonest of its lots to expire, and when last counted. */
  columns: { held: "On hand", status: "Status", expires: "Soonest expiry", counted: "Last counted" },
  noExpiry: "—",
  neverCounted: "Not yet",
  /** A phone's row, where the columns' names are not there to say what each date is. */
  phone: {
    expires: (date: string) => `Expires ${date}`,
    counted: (date: string) => `Counted ${date}`,
    notCounted: "Not counted yet",
  },
  expired: "Expired",
  expiresSoon: "Expires soon",
  /** A lot or a piece's label: "Expires 30 Nov 2027". */
  expires: (when: string) => `Expires ${when}`,
  record: {
    title: "Record a movement",
    what: "What happened",
    kinds: {
      delivery: "Delivery to the warehouse",
      transfer: "Transfer",
      count: "Count",
      write_off: "Write-off",
    },
    consumable: "Item",
    quantity: "How many",
    /** "How many (ml)": the unit beside the label, where the field takes a figure in it. */
    inUnit: (label: string, unit: string) => (unit === "" ? label : `${label} (${unit})`),
    from: "From",
    to: "To",
    waitForScan: "Counts once the technician scans it in",
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
    line: (place: string, was: string, now: string) => `${place}: ${was} → ${now}`,
    below: (place: string) => `${place} would go below zero.`,
    onItsWay: (place: string) => `${place}: arrives once scanned in`,
    same: "Matches what’s held. Records the count only.",
  },
  recorded: "Recorded.",
  movements: {
    title: "Latest movements",
    narrow: "Filter movements",
    columns: ["When", "Item", "Where", "Change", "Why", "Who"],
    reasons: {
      received: "Delivered",
      transferred: "Transfer",
      used: "Used on a visit",
      counted: "Count",
      written_off: "Write-off",
    },
    none: "No movements yet.",
    change: (quantity: number) => (quantity > 0 ? `+${String(quantity)}` : String(quantity)),
  },
  /** A refusal, said of the box it names (src/routes/ops/stock.ts). */
  errors: {
    not_permitted: NOT_PERMITTED,
    consumable_code: changed("That consumable is no longer listed."),
    from: changed("Unknown place."),
    to: "From and to must be different places.",
    place_id: changed("Unknown place."),
    lot_id: changed("That lot isn’t held there."),
    units: "A label scanned isn’t held there. Check the pieces.",
    quantity: "One delivery labels at most 500 pieces.",
    held: "More than that place holds. Check the quantity.",
    note: "Say what happened, in up to 200 characters.",
    offline: OFFLINE,
    unconfirmed: UNCONFIRMED,
    unknown: FAILED,
  },
} as const;

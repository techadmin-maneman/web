// Settings · Packages (docs/decisions/0211-packages.md): each package's hair systems, service visit and replacement.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";

export const packagesCopy = {
  title: "Packages",
  add: "Add package",
  addTitle: "New package",
  name: "Name",
  code: "Code",
  create: "Add",
  cancel: "Cancel",
  none: "No packages yet.",
  /** The list's columns: each part's price, what a first fit comes to for the client, and what it leaves us. */
  columns: {
    name: "Package",
    hairSystem: "Hair system from",
    service: "Service visit",
    every: "Every",
    firstFit: "First fit, client pays",
    replacement: "Replacement",
    after: "After",
    cost: "Cost to us",
    margin: "Margin",
    status: "Status",
  },
  /** A figure not set yet, in a column of figures. */
  gap: "—",
  open: (name: string) => `Open ${name}`,
  status: {
    sold: "On sale",
    unpriced: "Not priced",
    retiring: (from: string) => `Retiring ${from}`,
    retired: "Retired",
  },
  unpriced: "Not priced",
  minutes: (minutes: number) => `${String(minutes)} min`,
  days: (days: number) => `${String(days)} days`,
  months: (months: number) => `${String(months)} months`,
  /** The record's sections and rows. */
  sections: {
    package: "Package",
    firstFit: "First fit",
    service: "Service visit",
    replacement: "Replacement",
    hairSystems: "Hair systems",
  },
  rows: {
    name: "Name",
    description: "Description",
    noDescription: "None",
    length: "Length",
    price: "Price",
    every: "Due every",
    after: "Due after",
    total: "With its service visit",
    hairSystemFrom: "Hair system from",
    firstFitTotal: "With its service visit, from",
    cost: "Cost to us",
    notSet: "Not set",
  },
  units: { minutes: "min", days: "days", months: "months" },
  /** A hair system's table and its record. */
  hairSystems: {
    columns: { spec: "Hair system", price: "Price", cost: "Cost", status: "Status" },
    add: "Add hair system",
    addTitle: "New hair system",
    width: "Base width, in",
    length: "Base length, in",
    colour: "Colour",
    grey: "Grey, %",
    density: "Density, %",
    cost: "Cost to us, Rs.",
    create: "Add",
    open: (name: string) => `Open ${name}`,
    spec: (spec: {
      readonly base_width_in: number;
      readonly base_length_in: number;
      readonly colour: string;
      readonly grey_percent: number;
      readonly density_percent: number;
    }) =>
      `${String(spec.base_width_in)} × ${String(spec.base_length_in)} in · #${spec.colour} · ` +
      `${String(spec.grey_percent)}% grey · ${String(spec.density_percent)}% density`,
    offered: "On sale",
    retired: "Retired",
    none: "No hair systems yet. A first fit is sold once one has a price.",
    retire: "Retire",
    restore: "Sell again",
    delete: "Delete",
    deleteAsk: "Delete this hair system? It was never stocked, so nothing else changes.",
    retireAsk: "Retire from today? It stays on record, and stock of it is still counted.",
    close: "Close",
  },
  /** The foot of a package's record. */
  foot: {
    retire: "Retire",
    retireAsk: (name: string) =>
      `Stop selling ${name} from tomorrow? Clients already on it keep their service visits and replacements.`,
    restore: "Sell again",
    delete: "Delete",
    deleteAsk: (name: string) => `Delete ${name}? Nothing was sold under it, so nothing else changes.`,
    sold: "Sold before, so it can be retired but not deleted.",
    up: "Move up",
    down: "Move down",
  },
  /** A price row's own words. */
  price: {
    amount: "Before GST, Rs.",
    gst: "GST, %",
    from: "From",
    upcoming: (price: string, from: string) => `${price} from ${from}`,
    takeBack: (from: string) => `Withdraw the price from ${from}`,
    withdraw: "Withdraw",
    gstOf: (rupees: string, gst: number) => (gst === 0 ? rupees : `${rupees} + ${String(gst)}% GST`),
  },
  errors: {
    name: "Use 2 to 46 letters, digits, spaces and . , ' ( ) & + / -, a letter or digit first.",
    code: "Use small letters, digits and _, a letter first, up to 32.",
    description: "One line, up to 160 characters.",
    first_fit_minutes: "Between 30 minutes and the length of a day.",
    service_minutes: "Between 30 minutes and the length of a day.",
    replacement_minutes: "Between 30 minutes and the length of a day.",
    service_every_days: "Between 7 days and how far ahead clients can book.",
    replace_after_months: "Between 1 and 36 months.",
    amount_ex_gst: "A whole number of rupees.",
    gst_percent: "A whole percentage.",
    valid_from: "Tomorrow or later.",
    hair_system: "Another hair system has that spec.",
    service_exists: "Another package or service has that name.",
    in_use: "Sold before, so it can be retired but not deleted.",
    not_found: "This package is gone. Here’s the latest.",
    service_retired: "Retired by that day.",
    not_permitted: NOT_PERMITTED,
    offline: OFFLINE,
    unknown: FAILED,
  },
} as const;

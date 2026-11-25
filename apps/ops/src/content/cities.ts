// Admin › Cities: our cities, their GST registrations, and the rules and prices a city sets apart.

import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";

const common = {
  not_permitted: NOT_PERMITTED,
  offline: OFFLINE,
  unconfirmed: UNCONFIRMED,
  unknown: FAILED,
};

/** Names as a sentence lists them: "Delhi", "Delhi and Noida", "Delhi, Noida and Ghaziabad". */
const namesList = (names: readonly string[]): string =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

export const cities = {
  title: "Cities",
  list: {
    panel: "Cities",
    columns: {
      city: "City",
      state: "State",
      zone: "Zone",
      technicians: "Technicians",
      activeClients: "Active clients",
      status: "Status",
    },
    find: "Find a city",
    noState: "No state",
    served: "Served",
    notServed: "Not served",
    /** A city served that no active technician works in: clients there can book, and nobody can go. */
    noTechnician: "Served, but no technician works here",
    /** Beneath the cities: those that take bookings with nobody to send, named, as the redesign says it. */
    noTechnicians: (names: readonly string[]) =>
      `${namesList(names)} ${names.length === 1 ? "takes" : "take"} bookings but ${names.length === 1 ? "has" : "have"} no technician.`,
    hidden: "Not offered",
    noZone: "No zone",
    add: "Add a city",
    /** A row's name, read as what pressing it does. */
    open: (name: string) => `Open ${name}`,
  },
  form: {
    addTitle: "Add a city",
    name: "Name",
    stateCode: "State code",
    stateCodeHint: "Two letters: HR for Haryana",
    state: "State",
    zone: "Zone",
    noZone: "No zone",
    served: "Served",
    active: "Offered",
    added: "City added.",
    deleted: "City deleted.",
    add: "Add",
    yes: "Yes",
    no: "No",
    renames: (name: string) => `A new name moves every client, technician, pincode and price named ${name}.`,
    errors: {
      ...common,
      name: "Letters, spaces, dots and hyphens.",
      state_code: "Two capital letters.",
      state: "Name the state.",
      zone: "Choose one of our zones.",
      taken: "Another city has that name.",
      not_found: changed("That city has gone."),
      in_use: "Clients, pincodes or staff now name this city. Set Offered to No instead.",
    },
  },
  /** The rules a city sets for itself, in its record; one emptied is the national rule's again. */
  rules: {
    panel: "Its own rules",
    names: { checkin_radius_m: "Check-in radius", reminder_hour: "Reminder time" },
    units: { checkin_radius_m: "metres", reminder_hour: "hour of the day" },
    /** A rule the city follows from the national one: "National: 200 metres". */
    national: (figure: string) => `National: ${figure}`,
    errors: {
      ...common,
      value: "A whole number the national rule takes, or blank for the national rule.",
      not_found: changed("That city has gone."),
    },
    /** A city's figure refused against the national rule it keeps within. */
    conflicts: {
      checkin_radius_m: "A city’s check-in radius can’t be wider than the national radius at a rough pin.",
      reminder_hour: "A city’s reminders can’t go out after the address unlocks.",
    },
  },
  prices: {
    panel: "City prices",
    columns: { city: "City", service: "Service", price: "Price", gst: "GST", from: "From", withdraw: "Withdraw" },
    find: "Find a city or service",
    none: "No city prices",
    inForce: "In force",
    add: "Add a city price",
    city: "City",
    item: "Service",
    items: {
      consultation: "Consultation",
      first_fit: "First fit",
      service: "Service visit",
      replacement: "Replacement",
      hair_system: "Hair system",
      late_fee_first_fit: "Late fee on a first fit",
      late_fee_replacement: "Late fee on a replacement",
    },
    tier: "Tier",
    amount: "Price incl. GST, Rs.",
    gst: "GST %",
    from: "From",
    added: "Price set.",
    withdrawn: "Price withdrawn.",
    withdrawing: {
      open: "Withdraw",
      label: (item: string, city: string) => `Withdraw ${item} in ${city}`,
      warning: (item: string, city: string, from: string) => `Withdraw ${item} in ${city} from ${from}?`,
      confirm: "Withdraw",
      sending: "Withdrawing…",
    },
    errors: {
      ...common,
      valid_from: "Tomorrow at the earliest.",
      tier: "That service has no such tier.",
      amount: "Whole rupees, within the price book’s bounds.",
      gst_percent: "0–28.",
      service_retired: "That service is retired by then.",
      not_found: changed("Gone already."),
    },
  },
  /** The zones that group cities, which a grant of staff access may name (ADR 0109). */
  zones: {
    panel: "Zones",
    columns: { zone: "Zone", cities: "Cities" },
    noCities: "No city yet",
    add: "Add a zone",
    name: "Name",
    added: "Zone added.",
    deleted: "Zone deleted.",
    /** Beside the way to delete it, where something still names the zone. */
    inUse: "A city, stock place, technician or staff access still names this zone.",
    errors: {
      ...common,
      name: "Letters first, up to 40 characters.",
      taken: "A zone goes by that name already.",
      not_found: changed("That zone is gone."),
      in_use: "A city, stock place, technician or staff access still names this zone.",
    },
  },
  registrations: {
    panel: "GST registrations",
    columns: { state: "State", gstin: "GSTIN", branch: "Books branch", remove: "Remove" },
    none: "No registrations",
    add: "Add a registration",
    stateCode: "State code",
    gstin: "GSTIN",
    branch: "Books branch",
    noBranch: "None",
    added: "Registration set.",
    removed: "Registration removed.",
    removing: {
      open: "Remove",
      label: (state: string) => `Remove ${state}’s registration`,
      warning: (state: string) => `Remove ${state}’s registration?`,
      confirm: "Remove",
      sending: "Removing…",
    },
    errors: {
      ...common,
      state_code: "Two capital letters.",
      gstin: "15 characters, as on the certificate.",
      books_branch_id: "The branch’s ID in Books.",
      taken: "Another state has that GSTIN.",
      not_found: changed("Gone already."),
    },
  },
} as const;

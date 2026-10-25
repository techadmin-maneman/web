// Settings: the rules, the services and their prices, discount codes, the consumables, the job sheet and staff.

import { amountOf, quantity } from "@maneman/web-kit/figures";
import { rupees } from "@maneman/web-kit/money";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";
import { grantPhrasing } from "./settings-shell.ts";
import { dispatch } from "./dispatch.ts";
import { tasks } from "./tasks.ts";

/** A unit's noun for one of it: "1 visit", not "1 visits". */
const ONE_OF = /\b(visits|days|hours|minutes|periods|cases|fits|systems|write-offs|metres|codes)\b/;

/**
 * A rule's figure as a row reads it: rupees as the house writes an amount, a share with its sign, hours that make
 * whole days past a day as days, large counts grouped as India groups them, and one of a thing in the singular.
 */
function figureWords(value: number, unit: string): string {
  if (unit === "rupees") return rupees(value * 100);
  if (unit === "per cent") return `${quantity(value)}%`;
  if (unit.startsWith("% ")) return `${quantity(value)}${unit}`;
  if (unit === "hours" && value > 24 && value % 24 === 0) return `${quantity(value / 24)} days`;
  const noun = value === 1 ? unit.replace(ONE_OF, (word) => word.slice(0, -1)) : unit;
  return `${quantity(value)} ${noun}`;
}

/**
 * Settings: the business inputs ops set for themselves. The design draws this
 * section and letters nothing inside it (docs/decisions/0061-ops-editable-inputs.md,
 * docs/fidelity-method.md), so every line below is ours. Each field says its
 * bounds before it is typed, and a change is shown before it is made
 * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
 */
export const settings = {
  title: "Settings",
  /** Gigabytes as Cloudflare bills them, a thousand million bytes. */
  storage: (held: number, share: number) =>
    `Photos and referral cards: ${(held / 1e9).toFixed(2)} GB of ${String(share / 1e9)} GB`,
  /** Megabytes as Cloudflare counts them, a million bytes. */
  database: (held: number, limit: number) => `Database: ${(held / 1e6).toFixed(0)} MB of ${String(limit / 1e9)} GB`,
  /** No board draws discount codes (docs/decisions/0108-discount-codes.md). */
  discountCodes: {
    title: "Discount codes",
    make: "Create codes",
    how: "Method",
    typed: "Type one",
    generated: "Generate",
    code: "Code",
    count: "How many",
    takesOff: "Discount",
    percent: "Percentage",
    amount: "Amount",
    value: "Per cent",
    rupeesOff: "Amount off, Rs.",
    cap: "Cap, Rs. (optional)",
    covers: "Applies to",
    coverNames: {
      first_fit: "First fits, and consultation-and-fit visits",
      service: "Service visits",
      replacement: "Replacements",
    },
    expires: "Last valid day (optional)",
    maxUses: "Total uses (optional)",
    oncePerClient: "Once per client",
    makeButton: "Make",
    /** What will be made, read beneath the boxes once they hold a code. */
    summary: "What will be made",
    /** One line of the summary: what each code takes off. */
    off: (what: string) => `${what} off before GST`,
    percentOff: (percent: number, cap: string | null) =>
      cap === null ? `${String(percent)}%` : `${String(percent)}% (max ${cap})`,
    covering: (kinds: string) => `On ${kinds}`,
    until: (day: string | null) => (day === null ? "No end date" : `Ends ${day}`),
    usesLine: (uses: number | null, once: boolean) =>
      `${uses === null ? "Unlimited uses" : `${String(uses)} ${uses === 1 ? "use" : "uses"}`}${once ? ", once per client" : ""}`,
    oneTyped: (code: string) => `Code ${code}`,
    manyGenerated: (count: number) => `${String(count)} single-use codes`,
    oneGenerated: "One generated code",
    made: (codes: readonly string[]) => `Made: ${codes.join(", ")}`,
    close: "Close",
    /** Every code's figures together, above the table. */
    figures: {
      live: "Live codes",
      uses: "Uses",
      clients: "Clients",
      given: "Discount given",
      paid: "Revenue",
    },
    columns: {
      code: "Code",
      discount: "Discount",
      covers: "Applies to",
      ends: "Ends",
      uses: "Uses",
      clients: "Clients",
      given: "Given",
      paid: "Revenue",
      lastUsed: "Last used",
      offOn: "Switched off",
      state: "State",
    },
    states: { live: "Live", ended: "Ended", off: "Off" },
    offSince: (day: string) => `Off since ${day}`,
    coverShort: {
      first_fit: "First fit",
      service: "Service",
      replacement: "Replacement",
    },
    noEnd: "No end",
    ends: (day: string) => day,
    ended: (day: string) => `Ended ${day}`,
    never: "—",
    narrow: "Filter codes",
    switchedOff: "Switched off.",
    inUse: "A booking has used it. Switch it off instead.",
    deleted: "Deleted.",
    /** Codes are found by how they begin, so "SPR" finds SPRTEST. */
    find: "Code starts with",
    findButton: "Find",
    showAll: "Show latest",
    none: "No codes yet.",
    noneFound: "No matching codes.",
    /** How far a code with a limit is used: "3 of 10". */
    usesOf: (uses: number, most: number) => `${String(uses)} of ${String(most)}`,
    /** A row's name, read as what pressing it does. */
    open: (code: string) => `Open ${code}`,
    switching: {
      open: "Switch off",
      label: (code: string) => `Switch off ${code}`,
      warning: (code: string, uses: number) =>
        `Switch off ${code}? It can’t be used again. ${String(uses)} ${uses === 1 ? "booking keeps" : "bookings keep"} it.`,
      confirm: "Switch off",
      sending: "Switching off…",
      cancel: "Cancel",
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      code: "4–16 letters or digits, no spaces.",
      count: "A typed code is made once. Generate to make more.",
      value: "A percentage is 1–100. An amount is whole rupees.",
      cap: "Only a percentage takes a cap.",
      covers: "Choose what it applies to.",
      expires_on: "The last day can’t be in the past.",
      max_uses: "Generated codes are single-use.",
      code_exists: "That code already exists.",
      not_found: changed("That code no longer exists."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  rules: {
    groups: {
      moves: "Moves, cancels and no-shows",
      booking: "Booking and payment",
      field: "Visits in the field",
      reminders: "Reminders and replacements",
      referrals: "Referrals",
      tryon: "Try-on",
      care: "Customer Care",
      reports: "Reports",
      stock: "Stock",
      purchasing: "Purchasing",
      supply_plan: "Supply plan",
      limits: "Daily limits",
      console: "The console",
      other: "Other policies",
    },
    lateFees: "Late fees are set in Services",
    allowed: (min: number, max: number, unit: string) => `${String(min)}–${String(max)} ${unit}`,
    /** A figure read in words, its range as the words say it: "5 pm to 10 pm, on a 24-hour clock". */
    allowedWords: (min: string, max: string, how: string) => `${min} to ${max}, ${how}`,
    /** An hour of the day, typed on a 24-hour clock and read as "6 pm". */
    allowedHours: "on a 24-hour clock",
    hour: (hour: number) => {
      if (hour === 0) return "midnight";
      if (hour === 12) return "noon";
      return hour < 12 ? `${String(hour)} am` : `${String(hour - 12)} pm`;
    },
    /** A day of the week, typed 0 for Sunday to 6 for Saturday and read by its name. */
    allowedDays: "0 for Sunday",
    weekday: (day: number) =>
      ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? String(day),
    /** A figure typed outside its bounds, said in the hint's place, since it leaves Save with nothing to send. */
    outOfBounds: (min: string, max: string) => `Enter ${min}–${max}.`,
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    reset: "Reset to default",
    resetLabel: (rule: string) => `Reset ${rule} to default`,
    wasReset: "Back to the default.",
    undo: "Undo",
    /** Beside the title of a page of policies the person may read and not change. */
    viewOnly: "View only",
    /** The open-keyed rule's extra row: a currency, and its rate. */
    keyName: "Currency code, as USD",
    keyValue: "Rupees",
    add: "Add",
    defaultKey: "Every other currency",
    /**
     * The boxes of a rule with one figure per key: the kinds of visit and the
     * task queues, as the rest of the console names them. A base ops name
     * themselves shows as they typed it.
     */
    keyNames: {
      no_show_wait_min: dispatch.typeNames,
      late_change_charge: dispatch.typeNames,
      same_day_booking: dispatch.typeNames,
      booking_rules: {
        step: "Starts every",
        arrival: "Arrives within",
        wrap_up: "Wrap-up after each visit",
        lead: "Lead time for today",
        break: "Break",
        break_from: "Break taken from",
        break_to: "Break taken by",
        visits: "Most visits a day",
        fits: "Most fits a day",
      },
      working_hours: { opens: "Day starts", closes: "Day ends" },
      drive_estimate: {
        road_factor: "Road distance",
        peak_kmh: "Speed in the rush",
        offpeak_kmh: "Speed otherwise",
        parking: "To park and reach the door",
        least: "Shortest drive",
        morning_from: "Morning rush from",
        morning_to: "Morning rush until",
        evening_from: "Evening rush from",
        evening_to: "Evening rush until",
      },
      no_show_charge: dispatch.typeNames,
      // What a waiver gives back (docs/decisions/0088-every-policy-in-the-console.md).
      no_show_waiver: { payment: "The visit’s payment", credit: "The free service visit used" },
      task_sla_hours: tasks.groups,
      // The phone's two bounds.
      phone_clock: {
        before_start: "Earliest check-in before the start",
        held_offline: "Longest a phone may stay offline",
      },
      // The pay sheet's countdown and the grace after it (docs/decisions/0068-a-paid-hold-is-kept.md).
      payment_hold: {
        countdown: "Payment countdown",
        grace: "Grace after the countdown",
      },
      // The Technicians page's two figures.
      technician_work: {
        period: "Figures counted over",
        over_by: "Overrun from",
      },
      // The days the next visit turns on (docs/decisions/0086-the-next-visit-is-offered.md).
      booking_days: {
        first_fit_lead: "Consultation to first fit",
        /** Named where a package's cadence reaches past the horizon (Settings · Packages). */
        service_every_days: "A package’s service visits",
        reminder_before_due: "Reminder before a service is due",
        at_risk_after_due: "At risk after the due date",
        first_fit_to_book: "First fit booked within",
        horizon: "Bookable ahead",
        invoice_prompt: "New invoice shown on Home",
        replacement_order_lead: "Order a replacement before it’s due",
      },
      // What a referral earns, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
      referral_reward: {
        referrer_visits: "Referrer",
        friend_visits: "Friend",
        valid_days: "Free service visits valid for",
      },
      // Remedies (docs/decisions/0143-remedies.md).
      remedy_limit: { visits: "Free service visits", days: "Over" },
      // The national daily ceilings (src/policy/ops-settings-ceilings.ts).
      daily_ceilings: {
        login_code: "App login codes",
        tech_code: "Technician login codes",
        form_code: "Site WhatsApp codes",
        upload: "Try-on photographs",
        render: "Try-on looks",
        result_read: "Try-on results opened",
        geocode: "Address lookups",
        route: "Drive times",
        route_map: "Day maps",
      },
      // The rest of the rules (docs/decisions/0193-the-rest-of-the-rules-in-the-console.md).
      payment_links: {
        holds_hours: "Holds the slot for",
        closes_before_hours: "Closes before the visit",
        pay_within_days: "Link after a visit open for",
      },
      credit_reminder_days: { first: "First reminder", last: "Last reminder" },
      check_in_days: { first: "First check-in", second: "Second check-in" },
      stock_watch: {
        expiry_warning_days: "Expiry flagged within",
        demand_days: "Look ahead for demand",
        transfer_overdue_days: "Transfer overdue after",
      },
      stock_usage: {
        days: "Usage compared over",
        over_percent: "Flag a technician over expected by",
        min_visits: "Once they have done",
        write_offs: "Flag a kit at",
      },
      stock_quality: { failure_days: "Failure rates over the last", pace_days: "Usage pace over the last" },
      cycle_counts: {
        weekly: "Weekly items, every",
        monthly: "Monthly items, every",
        quarterly: "Quarterly items, every",
        recount_above_percent: "Recount a difference above",
      },
      kit_check: {
        from_hour: "Evening kit check from",
        one_visit_range: "Hair systems for a one-visit fit",
        top_up_weekday: "Week’s top-up on",
      },
      forecast_assumptions: {
        baseline_periods: "Baseline averaged over",
        learning_days: "Rates learned over the last",
        enough_to_learn: "Learned once there are",
        due_booking_percent: "Due clients who book",
        consultation_fit_percent: "Consultations that fit",
        consultation_to_fit_days: "Consultation to fit",
      },
      // The reply clock (docs/decisions/0132-the-reply-clock.md).
      care_hours: {
        opens: "Care opens",
        closes: "Care closes",
        first_reply: "First reply within",
        answered_by: "After-hours messages answered by",
      },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** Each choice a rule of choices offers, by the rule's name. */
    choiceNames: {
      late_change_charge: { nothing: "Nothing", late_fee: "Late fee", visit: "The full visit" },
      no_show_charge: { nothing: "Nothing", late_fee: "Late fee", visit: "The full visit" },
      no_show_waiver: { refunded: "Refunded", kept: "Kept", returned: "Returned", spent: "Spent" },
      same_day_booking: { yes: "Yes", no: "No" },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** The check before a rule is sent: each figure that moves, the old beside the new. */
    confirm: {
      /** A figure as a row reads it: "200 metres", "Rs. 5,00,000", "20%", "30 days", "1 visit". */
      figure: figureWords,
    },
    /** A section's Save sends its rules one by one, so a refusal speaks for its own rule only. */
    outside: (field: string, range: string) => `${field}: ${range}`,
    /** A choice refused: where the field is one of a list. */
    chooseOne: "Choose one of its options.",
    figures_conflict: (field: string, reached: string) => `“${field}” must be at least “${reached}”.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "Out of range.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /**
   * The day's half-slot times, from which the windows are read (docs/decisions/0102-window-times.md). No board draws
   * them. A change applies from a day nothing is booked or bookable on, and none is ever taken back.
   */
  windowTimes: {
    title: "Window times",
    inForce: "In force",
    window: { morning: "Morning", afternoon: "Afternoon", evening: "Evening" },
    /** "From Mon 2 Nov", or the times the console started with. */
    since: (date: string | null) => (date === null ? "As first set" : `From ${date}`),
    formTitle: "Change the times",
    appliesFrom: "From",
    /** The first day a change may take, after the last a client can book and the last visit booked. */
    earliest: (date: string) => `The earliest is ${date}.`,
    /** A half-slot's start box, by its window: "Morning starts", "Afternoon, half-slot 3 starts". */
    start: (window: string, position: number) =>
      position === 1 ? `${window} starts` : `${window}, half-slot ${String(position)} starts`,
    dayEnd: "The day ends",
    /** What a change will set, read beneath its boxes. */
    summary: "What changes",
    add: "Set",
    cancel: "Cancel",
    /** A window's line: "Morning: 9 am–12 noon → 9:30 am–12:30 pm". */
    change: (window: string, was: string, now: string) =>
      was === now ? `${window}: ${now}` : `${window}: ${was} → ${now}`,
    from: (date: string) => `From ${date}.`,
    set: "Set.",
    history: "Changes",
    setBy: (from: string, who: string, when: string) => `From ${from}, set by ${who} on ${when}`,
    /** What a change sets, beneath who set it: "Morning 9:30 am–12:30 pm · Afternoon …". */
    sets: (windows: readonly string[]) => windows.join(" · "),
    none: "No changes yet.",
    /** The last change, still to come, taken back: its days go back to the times before it. */
    withdrawing: {
      open: "Withdraw",
      label: (from: string) => `Withdraw the change from ${from}`,
      warning: (from: string) => `Withdraw the change from ${from}? Those days go back to the times before it.`,
      confirm: "Withdraw",
      sending: "Withdrawing…",
      cancel: "Keep it",
    },
    withdrawn: "Withdrawn.",
    errors: {
      not_permitted: NOT_PERMITTED,
      slot_times_too_soon: "That day is too soon: pick one from the earliest.",
      slot_times_in_use: "A visit is booked or held on that day or after, so its times stay.",
      not_found: "Already withdrawn.",
      not_eight_starts: "Give all eight starts.",
      not_a_time: "Give each time as hh:mm.",
      not_in_order: "Each start must follow the one before.",
      half_slot_too_short: "Each half-slot needs 45 minutes, the last one to the day’s end included.",
      outside_the_day: "Keep the day between 6 am and 10 pm.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** No board draws the days no visit is offered. */
  blackouts: {
    title: "Closed days",
    from: "From",
    to: "To",
    /** A day closed in one city closes no other (docs/decisions/0119-blackouts-by-city-and-trained-fitters.md). */
    city: "City",
    everyCity: "Every city",
    reason: "Reason",
    formTitle: "Close days",
    add: "Close",
    cancel: "Cancel",
    /** What closing the days leaves to move, said before they are closed. */
    stranded: (visits: number) =>
      `${String(visits)} ${visits === 1 ? "visit is" : "visits are"} booked on these days. Move ${
        visits === 1 ? "it" : "them"
      } on the dispatch board.`,
    uncounted: "Booked visits couldn’t be counted. Check the dispatch board.",
    none: "No closed days.",
    /** "Tue 20 Oct to Thu 22 Oct", and "Tue 20 Oct" for one day. */
    period: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    setBy: (who: string, when: string) => `Closed by ${who} on ${when}`,
    unrecorded: "Closed before this page existed.",
    booked: (visits: number) =>
      `${String(visits)} ${visits === 1 ? "visit is" : "visits are"} still booked. Move ${
        visits === 1 ? "it" : "them"
      } on the dispatch board.`,
    show: "Show on board",
    /** The link's whole name, since the list holds many and each link says the same. */
    showLabel: (period: string) => `Show on board: ${period}`,
    reopening: {
      open: "Reopen",
      /** The button's whole name, since the list holds many and each button says the same. */
      label: (period: string) => `Reopen ${period}`,
      warning: (period: string) => `Reopen ${period}?`,
      confirm: "Reopen",
      sending: "Reopening…",
      cancel: "Cancel",
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      from: "The first day can’t be in the past.",
      to: "The last day must follow the first, within a month.",
      reason: "Up to 60 characters, starting with a letter or a digit.",
      city: "Choose one of our cities.",
      not_found: changed("Already reopened."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /**
   * Settings · Consultation and fees (docs/decisions/0085-services-ops-can-edit.md): the consultation clients book and
   * the two late fees. Every other service is a package's (Settings · Packages, docs/decisions/0211-packages.md).
   */
  services: {
    consultation: "Consultation",
    lateFees: "Late fees",
    rows: { name: "Name", description: "Description", noDescription: "None", length: "Length", price: "Price" },
    minutes: (minutes: number) => `${String(minutes)} min`,
    unit: "min",
    unpriced: "Not priced",
    lateFeeNames: { late_fee_first_fit: "On a first fit", late_fee_replacement: "On a replacement" },
    /** The link to the rule that says when a late fee is charged. */
    lateFeeRule: "When it’s charged",
    errors: {
      not_permitted: NOT_PERMITTED,
      name: "2–60 characters, starting with a letter or digit.",
      description: "Keep it to one line.",
      minutes: "Between 30 minutes and the length of a day.",
      service_exists: "That name is already in use.",
      last_of_kind: "Clients would have nothing of this kind to book. Keep it offered.",
      in_use: "It belongs to a package. Change it in Packages.",
      not_found: changed("No longer exists."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  // No design draws them (docs/decisions/0165-suppliers.md).
  /** The consumables and each service's expected use (docs/decisions/0087-consumables-and-stock.md). */
  suppliers: {
    title: "Suppliers",
    columns: ["Supplier", "Country · currency", "Terms", "Warranty", "Status"],
    none: "No suppliers yet.",
    terms: (days: number) => (days === 0 ? "On delivery" : `${String(days)} days`),
    warranty: (days: number) => (days === 0 ? "None" : `${String(days)} days`),
    active: "Active",
    retired: "Retired",
    /** A row's name, read as what pressing it does. */
    open: (name: string) => `Open ${name}`,
    /** Its record's values, a line each. */
    rows: {
      name: "Name",
      gstin: "GSTIN",
      country: "Country code",
      currency: "Currency",
      contactName: "Contact",
      contactPhone: "Phone",
      contactEmail: "Email",
      terms: "Payment terms",
      warranty: "Warranty",
      status: "Status",
      days: "days",
      none: "None",
    },
    restore: "Restore",
    restoreLabel: (name: string) => `Restore ${name}`,
    retiring: {
      open: "Retire",
      label: (name: string) => `Retire ${name}`,
      warning: (name: string) => `Retire ${name}? Their open orders stay.`,
      confirm: "Retire",
      sending: "Retiring…",
      cancel: "Cancel",
    },
    added: "Added.",
    form: {
      addTitle: "Add a supplier",
      name: "Name",
      gstin: "GSTIN (optional)",
      country: "Country code",
      currency: "Currency",
      contactName: "Contact (optional)",
      contactPhone: "Phone, with country code (optional)",
      contactEmail: "Email (optional)",
      terms: "Payment terms, days",
      warranty: "Warranty, days",
      add: "Add",
      cancel: "Cancel",
    },
    item: {
      title: (name: string) => `What ${name} supplies`,
      addOne: "Add an item",
      columns: ["Item", "Their code", "Price", "Pack", "Minimum", "Lead time"],
      none: "Nothing listed yet.",
      allListed: "Every item is listed.",
      consumable: "Item",
      theirCode: "Their code (optional)",
      /** "Price per ml, INR": the price of one unit, never of a pack. */
      price: (currency: string, unit: string) => `Price per ${unit}, ${currency}`,
      pack: (unit: string) => `Pack size, ${unit}`,
      /** "INR 5.00 per ml" */
      perUnit: (price: string, unit: string) => `${price} per ${unit}`,
      /** "250 ml" */
      amount: (figure: number, unit: string) => amountOf(figure, unit),
      /** "Pack 250 ml", as an item's line reads it. */
      packOf: (amount: string) => `Pack ${amount}`,
      minimum: "Minimum order",
      lead: "Lead time, days",
      days: (days: number) => `${String(days)} days`,
      /** An item's values, a line each. */
      rows: {
        theirCode: "Their code",
        price: (unit: string) => `Price per ${unit}`,
        pack: "Pack size",
        lead: "Lead time",
      },
      removing: {
        open: "Remove",
        label: (name: string) => `Remove ${name}`,
        confirm: "Remove",
        sending: "Removing…",
        cancel: "Cancel",
      },
      removeQuestion: (item: string, supplier: string) => `Take ${item} off ${supplier}’s list?`,
    },
    errors: {
      name: "Another supplier has that name.",
      gstin: "15 characters: 07AABCK1234M1Z5.",
      country: "Two letters: IN.",
      currency: "Three letters: INR.",
      contact_name: "Up to 80 characters.",
      contact_phone: "With its country code: +919810000001.",
      contact_email: "An email address.",
      payment_terms_days: "Whole days, up to 365.",
      warranty_days: "Whole days, up to 3,650.",
      their_code: "Up to 40 characters.",
      unit_price: "A price, to two places.",
      pack_size: "A whole number, 1 or more.",
      minimum_order: "A whole number, 1 or more.",
      lead_time_days: "Whole days, up to 365.",
      consumable_code: changed("That item is no longer listed."),
      id: changed("That supplier is gone."),
      not_found: changed("That supplier is gone."),
      invalid_request: "Check the name, the GSTIN (15 characters) and the phone (10 digits).",
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  consumables: {
    find: "Find an item",
    title: "Consumables",
    add: "Add a consumable",
    columns: ["Consumable", "Cost each", "Low at", "Status"],
    none: "No consumables yet.",
    /** "Kit 5 · hub or stockroom 20 · warehouse 50", the levels each kind of place is low at. */
    levels: (at: { kit: number | null; store: number | null; central: number | null }) => {
      const parts = [
        at.kit === null ? null : `kit ${String(at.kit)}`,
        at.store === null ? null : `hub or stockroom ${String(at.store)}`,
        at.central === null ? null : `warehouse ${String(at.central)}`,
      ].filter((part) => part !== null);
      const words = parts.join(" · ");
      return words === "" ? "No level" : words.charAt(0).toUpperCase() + words.slice(1);
    },
    states: {
      offered: "Offered",
      retiring: (from: string) => `Offered until ${from}`,
      retired: (from: string) => `Retired from ${from}`,
    },
    /** A row's name, read as what pressing it does. */
    open: (name: string) => `Open ${name}`,
    /** Its record's values, a line each. */
    rows: {
      name: "Name",
      unit: "Unit",
      cost: "Cost each",
      kit: "Kit low at",
      store: "Hub or stockroom low at",
      central: "Warehouse low at",
      shelf: "Shelf life",
      status: "Status",
    },
    noLevel: "None",
    days: "days",
    /** "Keeps 180 days", what a lot with no expiry of its own is given. */
    shelfLife: (days: number | null) => (days === null ? "Does not expire" : `Keeps ${String(days)} days`),
    /** One added by mistake; one whose stock has moved is retired instead. */
    inUse: "Its stock has moved. Retire it instead.",
    deleted: "Deleted.",
    retire: "Retire",
    retireLabel: (name: string) => `Retire ${name}`,
    restore: "Restore",
    restoreLabel: (name: string) => `Restore ${name}`,
    // No design draws it (docs/decisions/0156-hair-systems-in-stock.md).
    form: {
      addTitle: "Add a consumable",
      changeTitle: (name: string) => `Change ${name}`,
      name: "Name",
      unit: "Unit",
      cost: "Cost each, Rs.",
      kit: "Kit low at (optional)",
      store: "Hub or stockroom low at (optional)",
      central: "Warehouse low at (optional)",
      shelf: "Shelf life, days (optional)",
      add: "Add",
      cancel: "Cancel",
      added: "Added.",
    },
    retiring: {
      from: "Retire from",
      question: (name: string, from: string) => `Technicians can’t log ${name} from ${from}. Past jobs keep it.`,
    },
    usage: {
      title: "Expected use per service",
      service: "Service",
      /** A service by its name, as the console names it; "Lace replacement, retired from 1 Oct 2027" once retired. */
      serviceName: (name: string, retiredFrom: string | null) =>
        retiredFrom === null ? name : `${name}, retired from ${retiredFrom}`,
      quantity: (name: string, unit: string) => `${name}, ${unit} per visit`,
      noneOffered: "Add a consumable first.",
      none: "None",
      whole: "A whole number up to 999, or blank.",
    },
    /** The cost refused, with the most the API takes. */
    unitCostUpTo: (most: string) => `Enter whole rupees, up to ${most}.`,
    /** A refusal, said of the box it names (src/routes/ops/consumables.ts). */
    errors: {
      not_permitted: NOT_PERMITTED,
      name: "That name is taken, or doesn’t start with a letter or digit.",
      unit: "Letters only: strip, ml, sachet.",
      unit_cost: "Enter the cost in whole rupees.",
      reorder_kit: "A whole number, or blank.",
      reorder_store: "A whole number, or blank.",
      reorder_central: "A whole number, or blank.",
      shelf_life_days: "A whole number of days, or blank.",
      from: "Today or later.",
      tier: "That service no longer exists.",
      items: "Unknown or repeated consumable.",
      not_found: changed("No longer listed."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** The job sheet the technician app reads: each kind of visit's checklist and the partial reasons. */
  jobSheet: {
    title: "Job sheet",
    kind: "Kind of visit",
    checklist: (type: string) => `${type} checklist`,
    reasons: "Partial reasons",
    /** Why a client is not going ahead after a consultation (docs/decisions/0149-lost-reasons.md). */
    lostReasons: "Reasons not going ahead",
    item: (position: number) => `Item ${String(position)}`,
    clientWords: (position: number) => `Item ${String(position)}, as the client reads it`,
    clientNote:
      "Beneath each item is what the client’s record says was done. Leave it empty for a step only the technician needs.",
    clientNone: "Only the technician sees it",
    reason: (position: number) => `Reason ${String(position)}`,
    /** The buttons beside an item: each names the item after what it does, so a screen reader says which. */
    upButton: "Move up",
    up: (label: string) => `Move up: ${label}`,
    downButton: "Move down",
    down: (label: string) => `Move down: ${label}`,
    removeButton: "Remove",
    remove: (label: string) => `Remove: ${label}`,
    add: "Add item",
    addReason: "Add reason",
    retired: "Removed",
    putBack: (label: string) => `Restore: ${label}`,
    putBackButton: "Restore",
    committed: "Default",
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    addButton: "Add",
    cancel: "Cancel",
    saved: "Saved.",
    /** A refusal of the list with the limits the API gave it. */
    limits: {
      items: (most: number) => `Keep 1 to ${String(most)} items.`,
      label: (longest: number) => `Give each item words, up to ${String(longest)} characters, with no repeats.`,
      client: (longest: number) => `Keep the client’s words to ${String(longest)} characters.`,
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      items: "Keep at least one item.",
      label: "Give each item words, with no repeats.",
      client: "Shorten the client’s words.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** No board draws the Staff page. A change is shown before it is saved. */
  staff: {
    title: "Staff",
    ...grantPhrasing,
    zones: "Zones",
    cities: "Cities",
    columns: { person: "Person", access: "Access", state: "Status" },
    noAccess: "No access",
    active: "Active",
    inactive: "Off",
    add: "Add a person",
    /** A row's name, read as what pressing it does. */
    open: (email: string) => `Open ${email}`,
    /** A grant's line in a person's record: "Finance · Delhi", its level beside it. */
    grantLabel: (department: string, place: string) => `${department} · ${place}`,
    form: {
      /** The console admits one Google group: a person added here signs in once they are in it too. */
      group: "Add them to the console’s Google group too, or they can’t sign in.",
      addTitle: "Add a person",
      email: "Sign-in email",
      access: "Access",
      department: "Department",
      level: "Level",
      place: "Where",
      /** The level that takes a grant away. */
      noAccess: "No access",
      addGrant: "Add a department",
      add: "Add",
      cancel: "Cancel",
    },
    saved: "Saved.",
    removed: "Removed.",
    /** Taking a person off the list; they may be added again. */
    removing: {
      open: "Remove",
      label: (email: string) => `Remove ${email}`,
      warning: (email: string) => `Remove ${email} from staff?`,
      confirm: "Remove",
      sending: "Removing…",
      cancel: "Cancel",
    },
    errors: {
      email: "Enter their sign-in email.",
      already_listed: "Already listed. Use Change.",
      place: "Choose where.",
      grants: "One grant per department and place.",
      not_permitted: "You need Admin · Manage, and can grant only within your own area.",
      last_admin: "Someone must keep national Admin · Manage. Grant it to someone else first.",
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
    enforcement: {
      title: "Access control",
      off: "Off. Everyone signed in sees every section.",
      on: "On. People see only what they’re granted.",
      setBy: (who: string, when: string) => `Changed by ${who} on ${when}`,
      starting: {
        open: "Turn on",
        label: () => "Turn on access control",
        warning: () => "Turn on access control? Only listed people can use the console.",
        confirm: "Turn on",
        sending: "Saving…",
        cancel: "Cancel",
      },
      stopping: {
        open: "Turn off",
        label: () => "Turn off access control",
        warning: () => "Turn off access control? Everyone signed in will see every section.",
        confirm: "Turn off",
        sending: "Saving…",
        cancel: "Cancel",
      },
      /** Typed before access control goes off for everyone. */
      typed: "OFF",
      errors: {
        not_permitted: "Only national Admin · Manage can change this.",
        offline: OFFLINE,
        unconfirmed: UNCONFIRMED,
        unknown: FAILED,
      },
    },
    tokens: {
      title: "Service tokens",
      none: "No service tokens.",
      addedBy: (who: string, when: string) => `Added by ${who} on ${when}`,
      clientId: "Client ID",
      label: "Name",
      addTitle: "Add a service token",
      removing: {
        open: "Remove",
        label: (label: string) => `Remove ${label}`,
        warning: (label: string) => `Remove ${label}? It’s refused once access control is on.`,
        confirm: "Remove",
        sending: "Removing…",
        cancel: "Cancel",
      },
      errors: {
        client_id: "Paste the client ID exactly as shown.",
        label: "Give it a short name.",
        not_found: changed("No longer listed."),
        not_permitted: "Only national Admin · Manage can change service tokens.",
        offline: OFFLINE,
        unconfirmed: UNCONFIRMED,
        unknown: FAILED,
      },
    },
  },
} as const;

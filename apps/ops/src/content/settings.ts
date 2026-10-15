// Settings: the rules, the services and their prices, discount codes, the consumables, the job sheet and staff.

import { amountOf } from "@maneman/web-kit/figures";
import { changed, FAILED, NOT_PERMITTED, OFFLINE, UNCONFIRMED } from "./common.ts";
import { grantPhrasing } from "./settings-shell.ts";
import { dispatch } from "./dispatch.ts";
import { tasks } from "./tasks.ts";

/** A service's description in a check line: quoted, or "no description". */
const descriptionWords = (line: string) => (line === "" ? "no description" : `“${line}”`);

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
    make: "Make codes",
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
    check: "Review",
    checkTitle: "Make these codes?",
    send: "Confirm",
    sending: "Making…",
    back: "Back",
    /** One line of the check: what each code takes off. */
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
      actions: "Actions",
    },
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
    switchedOffTitle: (count: number) => `Switched off (${String(count)})`,
    switchedOff: "Switched off.",
    delete: "Delete",
    deleteLabel: (code: string) => `Delete ${code}`,
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
    switchOff: "Switch off",
    switchOffLabel: (code: string) => `Switch off ${code}`,
    switchTitle: (code: string) => `Switch off ${code}?`,
    switchLine: (uses: number) =>
      `It can’t be used again. ${String(uses)} ${uses === 1 ? "booking keeps" : "bookings keep"} it.`,
    switching: "Switching off",
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
    changes: (count: number) => (count === 1 ? "1 change" : `${String(count)} changes`),
    discard: "Discard",
    /** Beside the title of a page of policies the person may read and not change. */
    viewOnly: "View only",
    /** The open-keyed rule's extra row: a base, and the cycle for it. */
    keyName: "Base, as the technician records it",
    keyValue: "Days",
    add: "Add",
    defaultKey: "All other bases",
    /**
     * The boxes of a rule with one figure per key: the kinds of visit and the
     * task queues, as the rest of the console names them. A base ops name
     * themselves shows as they typed it.
     */
    keyNames: {
      no_show_wait_min: dispatch.typeNames,
      late_change_charge: dispatch.typeNames,
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
        service_cadence: "Between service visits",
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
        demand_days: "Demand read ahead",
        transfer_overdue_days: "Transfer overdue after",
      },
      stock_usage: {
        days: "Usage read over",
        over_percent: "Technician flagged above",
        min_visits: "Across at least",
        write_offs: "Kit flagged at",
      },
      stock_quality: { failure_days: "Failure rates over", pace_days: "Pace read over" },
      cycle_counts: {
        weekly: "Weekly items, every",
        monthly: "Monthly items, every",
        quarterly: "Quarterly items, every",
        recount_above_percent: "Recount a difference above",
      },
      kit_check: { from_hour: "Check from", one_visit_range: "One-visit range", top_up_weekday: "Week’s top-up on" },
      forecast_assumptions: {
        baseline_periods: "Baseline averages",
        learning_days: "Rates learned over",
        enough_to_learn: "Learned from",
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
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** The check before a rule is sent: each figure that moves, the old beside the new. */
    confirm: {
      title: "Review the change",
      change: (label: string, was: string, now: string) => `${label}: ${was} → ${now}`,
      /** A figure as the check writes it: "200 metres". */
      figure: (value: number, unit: string) => `${String(value)} ${unit}`,
      /** A base ops are naming for the first time had no figure of its own. */
      noFigure: "none",
      /** A base whose own figure is taken away takes the one for every other base. */
      otherBases: "the figure for all other bases",
      /** A box of a rule with many, named with its rule: "No-show wait · First fit". */
      keyed: (rule: string, box: string) => `${rule} · ${box}`,
      standard: (rule: string) => `Resets ${rule} to the defaults.`,
      send: "Confirm",
      back: "Edit",
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
    start: (slot: number) => `Half-slot ${String(slot)} starts`,
    dayEnd: "The day ends",
    /** The check's line for a window: "Morning: 9 am–12 noon → 9:30 am–12:30 pm". */
    change: (window: string, was: string, now: string) =>
      was === now ? `${window}: ${now}` : `${window}: ${was} → ${now}`,
    from: (date: string) => `From ${date}.`,
    set: "Set.",
    history: "Changes",
    setBy: (from: string, who: string, when: string) => `From ${from}, set by ${who} on ${when}`,
    none: "No changes yet.",
    errors: {
      not_permitted: NOT_PERMITTED,
      slot_times_too_soon: "That day is too soon: pick one from the earliest.",
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
    /** The check's line: "Tue 20 Oct to Thu 22 Oct · Gurgaon · Diwali". */
    closing: (period: string, city: string, reason: string) => `${period} · ${city} · ${reason}`,
    /** What closing the days leaves to move, said before they are closed. */
    stranded: (visits: number) =>
      `${String(visits)} ${visits === 1 ? "visit is" : "visits are"} booked on these days. Move ${
        visits === 1 ? "it" : "them"
      } on the dispatch board.`,
    uncounted: "Booked visits couldn’t be counted. Check the dispatch board.",
    added: "Closed.",
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
    remove: "Reopen",
    /** The button's whole name, since the list holds many and each button says the same. */
    removeLabel: (period: string) => `Reopen ${period}`,
    reopen: (period: string) => `Reopen ${period}?`,
    errors: {
      not_permitted: NOT_PERMITTED,
      from: "The first day can’t be in the past.",
      to: "The last day must follow the first, within a month.",
      reason: "Up to 60 letters or digits.",
      city: "Choose one of our cities.",
      not_found: changed("Already reopened."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /** What each hair system costs us, for the margin figures (docs/decisions/0152-standard-costs.md). */
  standardCosts: {
    title: "Hair system costs",
    unit: "Rs., before GST",
    since: (date: string) => `since ${date}`,
    kinds: { first_fit: "First fit", replacement: "Replacement" },
    notSet: "Not set",
    saved: "Saved.",
    reviewLabel: (product: string) => `Review the cost of ${product}`,
    change: (product: string, was: string, now: string) => `${product}: ${was} → ${now}, from today`,
    errors: {
      invalid_request: "Type whole rupees.",
      not_found: changed("That product is no longer sold."),
      not_permitted: NOT_PERMITTED,
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
  },
  /**
   * No board draws the services (docs/decisions/0085-services-ops-can-edit.md). What a price or a change was is
   * shown beside what it will be before anything is sent.
   */
  services: {
    title: "Services and prices",
    /** The four kinds, as the rest of the console names them. */
    kinds: dispatch.typeNames,
    /** Each kind's table: its services, then its late fee where it has one. */
    columns: ["Service", "Length", "Before GST", "GST", "Next price"],
    actionsColumn: "Actions",
    minutes: (minutes: number) => `${String(minutes)} min`,
    retiring: (from: string) => `Hidden from ${from}`,
    retired: (from: string) => `Retired from ${from}`,
    /** A price form's line: what it costs today. */
    now: (price: string, since: string) => `${price} since ${since}`,
    unpriced: "Not priced",
    toCome: (price: string, from: string) => `${price} from ${from}`,
    /** "Rs. 1,234 + 18% GST": a price as the check compares two. */
    price: (rupees: string, gst: number) => `${rupees} + ${String(gst)}% GST`,
    earlier: (prices: readonly string[]) => `Earlier: ${prices.join(" · ")}`,
    percent: (value: number) => `${String(value)}%`,
    /** The two late fees, each one figure for its kind, beside its kind's services. */
    lateFee: "Late fee",
    lateFees: {
      late_fee_first_fit: "Late fee on a first fit",
      late_fee_replacement: "Late fee on a replacement",
    },
    /** The link to the rule that says when a late fee is charged. */
    lateFeeRule: "When it’s charged",
    actions: {
      edit: "Edit",
      price: "New price",
      correct: "Correct",
      takeBack: "Withdraw",
      rename: "Rename",
      describe: "Description",
      length: "Length",
      retire: "Retire",
      restore: "Restore",
      up: "Move up",
      down: "Move down",
      add: (kind: string) => `Add to ${kind}`,
      addHairSystem: "Add a hair system",
    },
    /** Each button named for a screen reader with what it acts on. */
    labels: {
      edit: (name: string) => `Edit ${name}`,
      price: (name: string) => `Change the price of ${name}`,
      correct: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      takeBack: (name: string, from: string) => `Withdraw the ${name} price from ${from}`,
      rename: (name: string) => `Rename ${name}`,
      describe: (name: string) => `Edit the description of ${name}`,
      length: (name: string) => `Change the length of ${name}`,
      retire: (name: string) => `Retire ${name}`,
      restore: (name: string) => `Restore ${name}`,
      up: (name: string) => `Move ${name} up`,
      down: (name: string) => `Move ${name} down`,
    },
    form: {
      priceTitle: (name: string) => `New price: ${name}`,
      correctTitle: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      amount: "Price before GST, Rs.",
      gst: "GST",
      from: "Starts",
      /** A day typed before tomorrow, said beside the box before anything is checked. */
      fromTooSoon: "Choose tomorrow or later.",
      setPrice: "Set price",
      renameTitle: (name: string) => `Rename ${name}`,
      name: "Name",
      describeTitle: (name: string) => `Description: ${name}`,
      description: "Description",
      lengthTitle: (name: string) => `Length: ${name}`,
      minutes: "Length, in minutes",
      retireTitle: (name: string) => `Retire ${name}`,
      retireFrom: "Hidden from",
      addTitle: (kind: string) => `New ${kind} service`,
      code: "Code",
      /** What a kind's code does beyond pricing it: a replacement under a hair system's code is offered to its wearers. */
      codeHints: {
        replacement: "Give it the code of the hair system it replaces, and clients who wear that one are offered it.",
      } as Readonly<Partial<Record<string, string>>>,
      next: "Review",
      cancel: "Cancel",
    },
    /** The check before anything is sent: what it is now, and what it will be. */
    check: {
      title: "Review the change",
      price: (name: string, was: string, now: string, from: string) => `${name}: ${was} → ${now}, from ${from}`,
      correct: ({
        name,
        was,
        wasFrom,
        now,
        from,
      }: {
        name: string;
        was: string;
        wasFrom: string;
        now: string;
        from: string;
      }) => `${name}: ${was} from ${wasFrom} → ${now} from ${from}`,
      nothing: "nothing",
      gstChanges: (was: number, now: number) => `GST: ${String(was)}% → ${String(now)}%`,
      sameDay: "Replaces the price already set for that day.",
      rename: (was: string, now: string, tier: string) => `${was} → ${now} (code stays ${tier})`,
      describe: (name: string, was: string, now: string) =>
        `${name}: ${descriptionWords(was)} → ${descriptionWords(now)}`,
      length: (name: string, was: number, now: number) => `${name}: ${String(was)} → ${String(now)} minutes`,
      retire: (name: string, from: string) => `${name} is hidden from ${from}.`,
      restore: (name: string) => `Offer ${name} again?`,
      order: (kind: string, was: string, now: string) => `${kind}: ${was} → ${now}`,
      add: (kind: string, name: string, minutes: number, _tier: string) =>
        `Add ${name} to ${kind}: ${String(minutes)} minutes. Hidden until priced.`,
      takeBack: (from: string) => `Withdraw the price from ${from}?`,
      send: "Confirm",
      back: "Back",
      takeBackConfirm: "Confirm withdrawal",
      keep: "Keep price",
    },
    saving: "Saving…",
    done: {
      price: "Price set.",
      takenBack: "Price withdrawn.",
      saved: "Saved.",
    },
    /** A refusal of a box with the limit the API gave the form, as the API checks it (src/routes/ops/services.ts). */
    limits: {
      description: (most: number) => `Up to ${String(most)} characters, on one line.`,
      minutes: (min: number, max: number) => `Enter ${String(min)}–${String(max)} minutes.`,
      amount: (most: string) => `Enter whole rupees, up to ${most}.`,
      gst: (most: number) => `Enter a whole percentage, 0–${String(most)}.`,
    },
    /** A refusal names the box it came from (src/routes/ops/services.ts, ops-settings.ts); these are said of each. */
    errors: {
      not_permitted: NOT_PERMITTED,
      tier: "No such code, or none can be made from that name.",
      name: "2–60 characters, starting with a letter or digit.",
      description: "Keep it to one line.",
      minutes: "Enter the minutes allowed.",
      retired_date: "Retire from today or later. Restore a retired service first.",
      order: changed("The order changed elsewhere."),
      amount_ex_gst: "Enter whole rupees.",
      gst_percent: "Enter a whole percentage.",
      valid_from: "A new price starts tomorrow at the earliest.",
      was_valid_from: "That price is already in effect, so it stays.",
      service_exists: "That name or code is already in use.",
      last_of_kind: "Each kind needs one priced service. Add and price its replacement first.",
      service_retired: "It’s retired by then, so it can’t be priced.",
      not_found: changed("No longer exists."),
      offline: OFFLINE,
      unconfirmed: UNCONFIRMED,
      unknown: FAILED,
    },
    /** Taking back a price that applies already, or has applied: it may stand on an invoice. */
    takeBackErrors: {
      not_permitted: NOT_PERMITTED,
      valid_from: "That price is already in effect, so it stays.",
      offline: OFFLINE,
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
    change: "Change",
    changeLabel: (name: string) => `Change ${name}`,
    retire: "Retire",
    retireLabel: (name: string) => `Retire ${name}`,
    restore: "Restore",
    restoreLabel: (name: string) => `Restore ${name}`,
    items: "Items",
    itemsLabel: (name: string) => `Items of ${name}`,
    retiredSaid: "Retired.",
    restoredSaid: "Restored.",
    retireQuestion: (name: string) => `Retire ${name}? Their open orders stay.`,
    restoreQuestion: (name: string) => `Restore ${name}?`,
    form: {
      addTitle: "Add a supplier",
      changeTitle: (name: string) => `Change ${name}`,
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
      save: "Save supplier",
      saving: "Saving…",
      cancel: "Cancel",
      added: "Added.",
      saved: "Saved.",
      confirm: {
        title: "Check before saving",
        line: (field: string, was: string, now: string) => `${field}: ${was} → ${now}`,
        /** "Lumina Hair Co · CN · USD" */
        adding: (name: string, country: string, currency: string) => `${name} · ${country} · ${currency}`,
        nothing: "Nothing changes.",
        none: "None",
        send: "Save",
        back: "Edit",
      },
    },
    item: {
      title: (name: string) => `What ${name} supplies`,
      addOne: "Add an item",
      columns: ["Item", "Their code", "Price", "Pack", "Minimum", "Lead time"],
      none: "Nothing listed yet.",
      consumable: "Item",
      theirCode: "Their code (optional)",
      /** "Price per ml, INR": the price of one unit, never of a pack. */
      price: (currency: string, unit: string) => `Price per ${unit}, ${currency}`,
      pack: (unit: string) => `Pack size, ${unit}`,
      /** "INR 5.00 per ml" */
      perUnit: (price: string, unit: string) => `${price} per ${unit}`,
      /** "250 ml" */
      amount: (figure: number, unit: string) => amountOf(figure, unit),
      /** "Pack 250 ml", as the line under review reads it. */
      packOf: (amount: string) => `Pack ${amount}`,
      minimum: "Minimum order",
      lead: "Lead time, days",
      days: (days: number) => `${String(days)} days`,
      set: "Save item",
      saved: "Saved.",
      remove: "Remove",
      removeLabel: (name: string) => `Remove ${name}`,
      removeQuestion: (item: string, supplier: string) => `Take ${item} off ${supplier}’s list?`,
      removed: "Removed.",
    },
    errors: {
      name: "Another supplier has that name.",
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
    // The buttons in each row, named for the screen reader by the consumable.
    change: "Change",
    changeLabel: (name: string) => `Change ${name}`,
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
    hairSystems: {
      title: "Hair systems",
      add: "Add a hair system",
      noProducts: "Add a first-fit service in Services first.",
      product: "Product",
      width: "Base width, inches",
      length: "Base length, inches",
      colour: "Colour",
      grey: "Grey, %",
      density: "Density",
      cost: "Cost each, Rs.",
      kit: "Kit low at (optional)",
      store: "Hub or stockroom low at (optional)",
      central: "Warehouse low at (optional)",
      formTitle: "Add a hair system",
      /** The check's line: the spec the code is made to, and what one costs. */
      adding: (spec: string, cost: string) => `${spec}, at ${cost} each`,
      added: "Added.",
      errors: {
        product: "Choose a product from the list.",
        hair_system: "That spec is already in stock.",
        invalid_request: "Check the size in inches, and grey and density as percentages, 0–100.",
        not_permitted: NOT_PERMITTED,
        offline: OFFLINE,
        unconfirmed: UNCONFIRMED,
        unknown: FAILED,
      },
    },
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
      save: "Save consumable",
      saving: "Saving…",
      cancel: "Cancel",
      added: "Added.",
      saved: "Saved.",
      /** The check before anything is sent, the old beside the new. */
      confirm: {
        title: "Review the change",
        adding: (name: string, unit: string, cost: string) => `${name}, by the ${unit}, at ${cost} each.`,
        line: (field: string, was: string, now: string) => `${field}: ${was} → ${now}`,
        fields: {
          name: "Name",
          unit: "Unit",
          cost: "Cost each",
          kit: "Kit low at",
          store: "Hub or stockroom low at",
          central: "Warehouse low at",
          shelf: "Shelf life",
        },
        noLevel: "none",
        send: "Confirm",
        back: "Edit",
        nothing: "No changes.",
      },
    },
    retiring: {
      title: (name: string) => `Retire ${name}`,
      from: "Retire from",
      question: (name: string, from: string) => `Technicians can’t log ${name} from ${from}. Past jobs keep it.`,
      restore: (name: string) => `Offer ${name} again?`,
      done: "Done.",
    },
    usage: {
      title: "Expected use per service",
      service: "Service",
      /** A service by its name, as the console names it; "Lace replacement, retired from 1 Oct 2027" once retired. */
      serviceName: (name: string, retiredFrom: string | null) =>
        retiredFrom === null ? name : `${name}, retired from ${retiredFrom}`,
      quantity: (name: string, unit: string) => `${name}, ${unit} per visit`,
      noneOffered: "Add a consumable first.",
      save: "Save use",
      confirm: {
        title: "Review the change",
        line: (name: string, was: string, now: string) => `${name}: ${was} → ${now}`,
        none: "none",
        send: "Confirm",
        back: "Edit",
        nothing: "No changes.",
      },
      saved: "Saved.",
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
      "The second box is what the client’s record says was done. Leave it empty for a step only the technician needs.",
    clientNone: "Only the technician sees it",
    reason: (position: number) => `Reason ${String(position)}`,
    /** The buttons beside an item: each names the item after what it does, so a screen reader says which. */
    upButton: "Move up",
    up: (label: string) => `Move up: ${label}`,
    downButton: "Move down",
    down: (label: string) => `Move down: ${label}`,
    removeButton: "Remove",
    remove: (label: string) => `Remove: ${label}`,
    unnamed: "the empty item",
    add: "Add item",
    addReason: "Add reason",
    retired: "Removed",
    putBack: (label: string) => `Restore: ${label}`,
    putBackButton: "Restore",
    committed: "Default",
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    confirm: {
      title: "Review the change",
      was: "Was",
      now: "Now",
      added: (label: string) => `Added: ${label}`,
      renamed: (was: string, now: string) => `Renamed: ${was} → ${now}`,
      takenOff: (label: string) => `Removed: ${label}`,
      clientReads: (label: string, words: string) => `${label}: the client reads “${words}”`,
      clientNone: (label: string) => `${label}: only the technician sees it`,
      moved: "Order changed.",
      send: "Confirm",
      back: "Edit",
      nothing: "No changes.",
    },
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
    change: "Change",
    changeLabel: (email: string) => `Change ${email}`,
    form: {
      addTitle: "Add a person",
      changeTitle: (email: string) => `Change ${email}`,
      email: "Sign-in email",
      letIn: "Active",
      access: "Access",
      department: "Department",
      level: "Level",
      place: "Where",
      addGrant: "Add a department",
      removeGrant: "Remove",
      removeGrantLabel: (grant: string) => `Remove ${grant}`,
      review: "Review",
      cancel: "Cancel",
    },
    confirm: {
      title: "Review the change",
      adds: (email: string) => `Adds ${email}.`,
      letsIn: "Restores their access.",
      switchesOff: "Removes all their access.",
      gives: (grant: string) => `Grants ${grant}`,
      takes: (grant: string) => `Removes ${grant}`,
      nothing: "No changes.",
      send: "Confirm",
      sending: "Saving…",
      back: "Edit",
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
      start: "Turn on",
      stop: "Turn off",
      startTitle: "Turn on access control?",
      startLine: "Only listed people can use the console.",
      stopTitle: "Turn off access control?",
      stopLine: "Everyone signed in will see every section.",
      sending: "Saving…",
      back: "Cancel",
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
      /** The check's line: "Uptime check · 1a2b3c.access". */
      adding: (label: string, clientId: string) => `${label} · ${clientId}`,
      remove: "Remove",
      removeLabel: (label: string) => `Remove ${label}`,
      removeTitle: (label: string) => `Remove ${label}?`,
      removeLine: "It’s refused once access control is on.",
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

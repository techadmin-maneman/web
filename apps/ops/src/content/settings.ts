// Settings: the rules, the services and their prices, discount codes, the consumables, the job sheet and staff.

import { FAILED, NOT_PERMITTED, OFFLINE } from "./common.ts";
import { DEPARTMENT_NAMES } from "./shell.ts";
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
  sub: "Changes apply within a minute.",
  /** Gigabytes as Cloudflare bills them, a thousand million bytes. */
  storage: (held: number, share: number) =>
    `Photos and referral cards: ${(held / 1e9).toFixed(2)} GB of ${String(share / 1e9)} GB`,
  /** Megabytes as Cloudflare counts them, a million bytes. */
  database: (held: number, limit: number) => `Database: ${(held / 1e6).toFixed(0)} MB of ${String(limit / 1e9)} GB`,
  tabs: {
    rules: "Policies",
    blackouts: "Closed days",
    consumables: "Consumables",
    "job-sheet": "Job sheet",
  },
  /** No board draws discount codes (docs/decisions/0108-discount-codes.md). */
  discountCodes: {
    title: "Discount codes",
    note: "Off a first fit, service visit or replacement, before GST. Never on a free service visit. Fixed once a visit is paid or invoiced.",
    make: "Make codes",
    how: "Method",
    typed: "Type one",
    generated: "Generate",
    code: "Code",
    codeHint: "4–16 letters or digits.",
    count: "How many",
    countHint: (most: number) => `1–${String(most)}. More than one makes single-use codes.`,
    takesOff: "Discount",
    percent: "Percentage",
    amount: "Amount",
    value: "Per cent",
    rupeesOff: "Rupees",
    cap: "Cap, in rupees",
    capHint: "Optional.",
    covers: "Applies to",
    coverNames: {
      first_fit: "First fits, and consultation-and-fit visits",
      service: "Service visits",
      replacement: "Replacements",
    } as Readonly<Record<string, string>>,
    expires: "Last valid day",
    expiresHint: "Optional.",
    maxUses: "Total uses",
    maxUsesHint: "Optional.",
    oncePerClient: "Once per client",
    check: "Review",
    checkTitle: "Make these codes?",
    send: "Confirm",
    sending: "Making",
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
    /** Codes are found by how they begin, so "SPR" finds SPRTEST. */
    find: "Code starts with",
    findButton: "Find",
    showAll: "Show latest",
    none: "No codes yet.",
    noneFound: "No matching codes.",
    /** How far a code is used: "3 of 10 uses", or "3 uses" with no limit. */
    usesOf: (uses: number, most: number | null) =>
      most === null ? `${String(uses)} ${uses === 1 ? "use" : "uses"}` : `${String(uses)} of ${String(most)} uses`,
    given: (amount: string) => `${amount} given`,
    madeBy: (who: string, when: string) => `Made by ${who} on ${when}`,
    switchedOffBy: (who: string, when: string) => `Switched off by ${who} on ${when}`,
    switchOff: "Switch off",
    switchOffLabel: (code: string) => `Switch off ${code}`,
    switchTitle: (code: string) => `Switch off ${code}?`,
    switchLine: (uses: number) =>
      `It can't be used again. ${String(uses)} ${uses === 1 ? "booking keeps" : "bookings keep"} it.`,
    switching: "Switching off",
    errors: {
      not_permitted: NOT_PERMITTED,
      code: "4–16 letters or digits, no spaces.",
      count: "A typed code is made once. Generate to make more.",
      value: "A percentage is 1–100. An amount is whole rupees.",
      cap: "Only a percentage takes a cap.",
      covers: "Choose what it applies to.",
      expires_on: "The last day can't be in the past.",
      max_uses: "Generated codes are single-use.",
      code_exists: "That code already exists.",
      not_found: "That code no longer exists. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  rules: {
    title: "Policies",
    groups: {
      moves: "Moves, cancels and no-shows",
      booking: "Booking and payment",
      field: "Visits in the field",
      reminders: "Reminders and replacements",
      referrals: "Referrals",
      console: "The console",
      other: "Other policies",
    },
    jump: "Jump to",
    lateFees: "Late fees are set in Prices",
    allowed: (min: number, max: number, unit: string) => `${String(min)}–${String(max)} ${unit}`,
    /** An hour of the day, typed on a 24-hour clock and read as "6 pm". */
    allowedHours: (min: string, max: string) => `${min} to ${max}, on a 24-hour clock`,
    hour: (hour: number) => {
      if (hour === 0) return "midnight";
      if (hour === 12) return "noon";
      return hour < 12 ? `${String(hour)} am` : `${String(hour - 12)} pm`;
    },
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    /** A figure typed outside its bounds, said in the hint's place, since it leaves Save with nothing to send. */
    outOfBounds: (min: string, max: string) => `Enter ${min}–${max}.`,
    committed: "Default",
    save: "Save",
    saving: "Saving",
    saved: "Saved.",
    reset: "Reset to default",
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
      no_show_waiver: { payment: "The visit's payment", credit: "The free service visit used" },
      task_sla_hours: tasks.groups,
      // The phone's two bounds (docs/decisions/0088-every-policy-in-the-console.md).
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
        replacement_order_lead: "Order a replacement before it's due",
      },
      // What a referral earns, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
      referral_reward: {
        referrer_visits: "Referrer",
        friend_visits: "Friend",
        valid_days: "Free visits valid for",
      },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** Each choice a rule of choices offers, by the rule's name (docs/decisions/0088-every-policy-in-the-console.md). */
    choiceNames: {
      late_change_charge: { nothing: "Nothing", late_fee: "Late fee", visit: "The full visit" },
      no_show_charge: { nothing: "Nothing", late_fee: "Late fee", visit: "The full visit" },
      no_show_waiver: { refunded: "Refunded", kept: "Kept", returned: "Returned", spent: "Spent" },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /** The check before a rule is sent: each figure that moves, the old beside the new. */
    confirm: {
      title: "Review the change",
      change: (label: string, was: string, now: string) => `${label}: ${was} → ${now}.`,
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
    outside: (field: string) => `${field}: out of range. Not saved.`,
    conflict: (field: string, reached: string) => `“${field}” must be at least “${reached}”. Not saved.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "Out of range. Not saved.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** No board draws the days no visit is offered (docs/decisions/0088-every-policy-in-the-console.md). */
  blackouts: {
    title: "Closed days",
    /** Followed by a link to the dispatch board. */
    note: "No new bookings on these days. Visits already booked stay: move them on",
    board: "the dispatch board",
    from: "From",
    to: "To",
    reason: "Reason",
    add: "Close these days",
    adding: "Closing",
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
    removing: "Reopening",
    errors: {
      not_permitted: NOT_PERMITTED,
      from: "The first day can't be in the past.",
      to: "The last day must follow the first, within a month.",
      reason: "Up to 60 letters or digits.",
      not_found: "Already reopened. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /**
   * No board draws the services (docs/decisions/0085-services-ops-can-edit.md). What a price or a change was is
   * shown beside what it will be before anything is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
   */
  services: {
    title: "Services and prices",
    note: "What clients can book. A new price starts tomorrow at the earliest.",
    /** The four kinds, as the rest of the console names them. */
    kinds: dispatch.typeNames,
    /** Under First fit: its services are the hair systems clients choose from, and nothing stands in for them. */
    hairSystems: "First fits are booked as one of these hair systems. With none priced, first fits can't be booked.",
    /** "180 min · premium": how long it is held and booked for, and what the price book prices it by. */
    facts: (minutes: number, tier: string) => `${String(minutes)} min · ${tier}`,
    /** The line clients read under the service's name in the app as they choose. */
    described: (line: string) => `Clients see: “${line}”`,
    notDescribed: "No description.",
    offered: "Offered",
    retiring: (from: string) => `Hidden from ${from}`,
    retired: (from: string) => `Retired from ${from}`,
    /** Under a service, what it costs today, and what it will from a later day. */
    now: (price: string, since: string) => `${price} since ${since}`,
    unpriced: "No price. Hidden from clients.",
    toCome: (price: string, from: string) => `${price} from ${from}`,
    /** "Rs. 2,000 + 18% GST": a price as the check compares two. */
    price: (rupees: string, gst: number) => `${rupees} + ${String(gst)}% GST`,
    history: (count: number) => (count === 1 ? "1 earlier price" : `${String(count)} earlier prices`),
    historyCaption: (name: string) => `Earlier prices of ${name}`,
    historyColumns: ["Before GST", "GST", "From"],
    percent: (value: number) => `${String(value)}%`,
    /** The two late fees, each one figure for its kind, beside its kind's services. */
    lateFees: {
      late_fee_first_fit: "Late fee on a first fit",
      late_fee_replacement: "Late fee on a replacement",
    } as Readonly<Record<string, string>>,
    lateFeeNote: "Charged for a late move or cancel.",
    /** The link to the rule that says when a late fee is charged. */
    lateFeeRule: "When it applies",
    actions: {
      price: "Change price",
      correct: "Correct",
      takeBack: "Withdraw",
      rename: "Rename",
      describe: "Edit description",
      length: "Change length",
      retire: "Retire",
      restore: "Restore",
      up: "Move up",
      down: "Move down",
      add: (kind: string) => `Add to ${kind}`,
      addHairSystem: "Add a hair system",
    },
    /** Each button named for a screen reader with what it acts on. */
    labels: {
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
      amount: "Price before GST, in rupees",
      amountHint: (max: string) => `Whole rupees, up to ${max}.`,
      gst: "GST",
      gstHint: (max: number) => `0–${String(max)}%.`,
      from: "Starts",
      fromHint: "Tomorrow or later.",
      /** A day typed before tomorrow, said beside the box before anything is checked. */
      fromTooSoon: "Choose tomorrow or later.",
      setPrice: "Set price",
      renameTitle: (name: string) => `Rename ${name}`,
      name: "Name",
      nameHint: "Starts with a letter or digit.",
      describeTitle: (name: string) => `Description: ${name}`,
      description: "Description",
      descriptionHint: (max: number) => `One line under the name. Up to ${String(max)} characters.`,
      lengthTitle: (name: string) => `Length: ${name}`,
      minutes: "Length, in minutes",
      minutesHint: (min: number, max: number) => `${String(min)}–${String(max)}.`,
      retireTitle: (name: string) => `Retire ${name}`,
      retireFrom: "Hidden from",
      retireHint: "Today or later. Visits already sold aren't affected.",
      addTitle: (kind: string) => `New ${kind} service`,
      code: "Code",
      codeHint: "Made from the name. Can't be changed.",
      next: "Review",
      cancel: "Cancel",
    },
    /** The check before anything is sent: what it is now, and what it will be. */
    check: {
      title: "Review the change",
      price: (name: string, was: string, now: string, from: string) => `${name}: ${was} → ${now}, from ${from}.`,
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
      }) => `${name}: ${was} from ${wasFrom} → ${now} from ${from}.`,
      nothing: "nothing",
      gstChanges: (was: number, now: number) => `GST: ${String(was)}% → ${String(now)}%.`,
      sameDay: "Replaces the price already set for that day.",
      rename: (was: string, now: string, tier: string) => `${was} → ${now}. The code stays ${tier}.`,
      describe: (name: string, was: string, now: string) =>
        `${name}: ${descriptionWords(was)} → ${descriptionWords(now)}`,
      length: (name: string, was: number, now: number) =>
        `${name}: ${String(was)} → ${String(now)} minutes. Existing bookings keep their length.`,
      retire: (name: string, from: string) => `${name} is hidden from ${from}. Visits already sold aren't affected.`,
      restore: (name: string) => `Offer ${name} again, at its existing prices.`,
      order: (kind: string, was: string, now: string) => `${kind}: ${was} → ${now}.`,
      add: (kind: string, name: string, minutes: number, tier: string) =>
        `Add ${name} to ${kind}: ${String(minutes)} minutes, code ${tier}. Hidden until priced.`,
      takeBack: (from: string) => `Withdraw the price from ${from}? The earlier price stays.`,
      send: "Confirm",
      back: "Back",
      takeBackConfirm: "Confirm withdrawal",
      keep: "Keep",
    },
    saving: "Saving",
    done: {
      price: "Price set.",
      takenBack: "Price withdrawn.",
      saved: "Saved.",
    },
    /** A refusal names the box it came from (src/routes/ops/services.ts, ops-settings.ts); these are said of each. */
    errors: {
      not_permitted: NOT_PERMITTED,
      tier: "No such code, or none can be made from that name.",
      name: "2–60 characters, starting with a letter or digit.",
      description: "One line, within the limit.",
      minutes: "Outside the allowed range.",
      retired_date: "Retire from today or later. Restore a retired service first.",
      order: "The order changed elsewhere. Reload.",
      amount_ex_gst: "Whole rupees, within the range.",
      gst_percent: "A whole percentage, within the range.",
      valid_from: "A new price starts tomorrow at the earliest.",
      was_valid_from: "That price is already in effect, so it stays.",
      service_exists: "That name or code is already in use.",
      last_of_kind: "Each kind needs one priced service. Add and price its replacement first.",
      service_retired: "It's retired by then, so it can't be priced.",
      not_found: "No longer exists. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
    /** Taking back a price that applies already, or has applied: it may stand on an invoice. */
    takeBackErrors: {
      not_permitted: NOT_PERMITTED,
      valid_from: "That price is already in effect, so it stays.",
    } as Readonly<Record<string, string>>,
  },
  /** The consumables and each service's expected use (docs/decisions/0087-consumables-and-stock.md). */
  consumables: {
    title: "Consumables",
    note: "What technicians log on a job, and what each costs us. Costs never reach an invoice.",
    columns: ["Consumable", "Cost each", "Low at", "Status"],
    none: "No consumables yet.",
    /** "Kit 5 · store 50", the levels a place is low at. */
    levels: (kit: number | null, central: number | null) => {
      if (kit === null && central === null) return "No level";
      const parts = [kit === null ? null : `Kit ${String(kit)}`, central === null ? null : `store ${String(central)}`];
      return parts.filter((part) => part !== null).join(" · ");
    },
    states: {
      offered: "Offered",
      retiring: (from: string) => `Offered until ${from}`,
      retired: (from: string) => `Retired from ${from}`,
    },
    // The buttons in each row, named for the screen reader by the consumable.
    change: "Change",
    changeLabel: (name: string) => `Change ${name}`,
    retire: "Retire",
    retireLabel: (name: string) => `Retire ${name}`,
    restore: "Restore",
    restoreLabel: (name: string) => `Restore ${name}`,
    form: {
      addTitle: "Add a consumable",
      changeTitle: (name: string) => `Change ${name}`,
      name: "Name",
      nameHint: "Starts with a letter or digit.",
      unit: "Unit",
      unitHint: "Strip, ml, sachet.",
      cost: "Cost each, in rupees",
      costHint: (max: string) => `Up to ${max}.`,
      kit: "Kit low at",
      central: "Store low at",
      levelHint: "Optional.",
      add: "Add",
      save: "Save consumable",
      saving: "Saving",
      cancel: "Cancel",
      added: "Added.",
      saved: "Saved.",
      /** The check before anything is sent, the old beside the new. */
      confirm: {
        title: "Review the change",
        adding: (name: string, unit: string, cost: string) => `${name}, by the ${unit}, at ${cost} each.`,
        line: (field: string, was: string, now: string) => `${field}: ${was} → ${now}`,
        fields: { name: "Name", unit: "Unit", cost: "Cost each", kit: "Kit low at", central: "Store low at" },
        noLevel: "none",
        send: "Confirm",
        back: "Edit",
        nothing: "No changes.",
      },
    },
    retiring: {
      title: (name: string) => `Retire ${name}`,
      from: "Retire from",
      fromHint: "Today or later. Past records and stock stay.",
      question: (name: string, from: string) => `Technicians can't log ${name} from ${from}. Past jobs keep it.`,
      send: "Confirm",
      restore: (name: string) => `Offer ${name} again?`,
      restoreSend: "Confirm",
      done: "Done.",
    },
    usage: {
      title: "Expected use per service",
      note: "Pre-filled on each job. Technicians can adjust it.",
      service: "Service",
      /** A service by its name, as the console names it; "Lace replacement, retired from 1 Oct 2027" once retired. */
      serviceName: (name: string, retiredFrom: string | null) =>
        retiredFrom === null ? name : `${name}, retired from ${retiredFrom}`,
      quantity: (name: string, unit: string) => `${name}, ${unit} per visit`,
      quantityHint: (max: number) => `Up to ${String(max)}. Blank for none.`,
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
    /** A refusal, said of the box it names (src/routes/ops/consumables.ts). */
    errors: {
      not_permitted: NOT_PERMITTED,
      name: "That name is taken, or doesn't start with a letter or digit.",
      unit: "Letters only: strip, ml, sachet.",
      unit_cost: "Outside the allowed range.",
      reorder_kit: "A whole number, or blank.",
      reorder_central: "A whole number, or blank.",
      from: "Today or later.",
      tier: "That service no longer exists.",
      items: "Unknown or repeated consumable.",
      not_found: "No longer listed. Reload.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** The job sheet the technician app reads: each kind of visit's checklist and the partial reasons. */
  jobSheet: {
    title: "Job sheet",
    note: "The checklist for each kind of visit, and the reasons for a partly done job. Phones pick up changes on the next job.",
    kind: "Kind of visit",
    checklist: (type: string) => `${type} checklist`,
    reasons: "Partial reasons",
    reasonsNote: "A partly done job waits on Tasks with its reason.",
    item: (position: number) => `Item ${String(position)}`,
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
    retiredNote: "Kept so older jobs still read correctly.",
    putBack: (label: string) => `Restore: ${label}`,
    putBackButton: "Restore",
    committed: "Default",
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    hint: (most: number, longest: number) =>
      `1–${String(most)} items, up to ${String(longest)} characters each, no repeats.`,
    save: "Save",
    saving: "Saving",
    saved: "Saved.",
    confirm: {
      title: "Review the change",
      was: "Was",
      now: "Now",
      added: (label: string) => `Added: ${label}`,
      renamed: (was: string, now: string) => `Renamed: ${was} → ${now}`,
      takenOff: (label: string) => `Removed: ${label}`,
      moved: "Order changed.",
      send: "Confirm",
      back: "Edit",
      nothing: "No changes.",
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      items: "Too few or too many items.",
      label: "Each item needs words, within the limit, with no repeats.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
  },
  /** No board draws the Staff page. A change is shown before it is saved. */
  staff: {
    title: "Staff",
    note: "Who can use the console. Each grant is one department, one level, one place. View reads, Act works, Manage also refunds, waives, sets prices and settings, deletes accounts and grants access.",
    departments: DEPARTMENT_NAMES,
    levels: { view: "View", act: "Act", manage: "Manage" },
    national: "National",
    zone: (name: string) => `${name} zone`,
    zones: "Zones",
    cities: "Cities",
    grant: (department: string, level: string, place: string) => `${department} · ${level} · ${place}`,
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
      emailHint: "The address they sign in with.",
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
      sending: "Saving",
      back: "Edit",
    },
    saved: "Saved.",
    errors: {
      email: "Enter their sign-in email.",
      already_listed: "Already listed. Use Change.",
      place: "Choose where.",
      grants: "One grant per department and place.",
      not_permitted: "You need Admin · Manage, and can grant only within your own area.",
      last_admin: "Someone must keep national Admin · Manage. Grant it to someone else first.",
      offline: OFFLINE,
      unknown: FAILED,
    } as Readonly<Record<string, string>>,
    enforcement: {
      title: "Access control",
      off: "Off. Everyone signed in sees every section, and calls the list would refuse are logged. Check the list, then turn it on.",
      on: "On. People see only what they're granted.",
      setBy: (who: string, when: string) => `Changed by ${who} on ${when}`,
      start: "Turn on",
      stop: "Turn off",
      startTitle: "Turn on access control?",
      startLine: "Only the people listed can use the console, as granted.",
      stopTitle: "Turn off access control?",
      stopLine: "Everyone signed in will see every section.",
      sending: "Saving",
      back: "Cancel",
      onlyNational: "Only national Admin · Manage can change this.",
      errors: {
        not_permitted: "Only national Admin · Manage can change this.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
    tokens: {
      title: "Service tokens",
      note: "Automated access, such as the test runner. A listed token can do everything except grant access.",
      none: "No service tokens.",
      addedBy: (who: string, when: string) => `Added by ${who} on ${when}`,
      clientId: "Client ID",
      clientIdHint: "From Cloudflare Access, under Service credentials.",
      label: "Name",
      add: "Add token",
      adding: "Adding",
      remove: "Remove",
      removeLabel: (label: string) => `Remove ${label}`,
      removeTitle: (label: string) => `Remove ${label}?`,
      removeLine: "It's refused once access control is on.",
      removing: "Removing",
      back: "Keep",
      onlyNational: "Only national Admin · Manage can change service tokens.",
      errors: {
        client_id: "Paste the client ID exactly as shown.",
        label: "Give it a short name.",
        not_found: "No longer listed. Reload.",
        not_permitted: "Only national Admin · Manage can change service tokens.",
        offline: OFFLINE,
        unknown: FAILED,
      } as Readonly<Record<string, string>>,
    },
  },
} as const;

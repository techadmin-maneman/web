// Settings: the rules, the services and their prices, discount codes, the consumables, the job sheet and staff.

import { NOT_PERMITTED } from "./common.ts";
import { DEPARTMENT_NAMES } from "./shell.ts";
import { dispatch } from "./dispatch.ts";
import { tasks } from "./tasks.ts";

/** A service's description in a check line: quoted, or "no description". */
const descriptionWords = (line: string) => (line === "" ? "no description" : `“${line}”`);

/**
 * Settings: the business inputs ops set for themselves. The design draws this
 * section and letters nothing inside it (docs/decisions/0061-ops-editable-inputs.md,
 * docs/fidelity-method.md), so every line below is ours. Each field says its
 * unit and what the figure may be before it is typed, not after it is refused,
 * and a change that cannot be taken back is shown before it is made
 * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
 */
export const settings = {
  title: "Settings",
  sub: "A change takes effect within a minute. No release is needed.",
  /**
   * No board draws the storage meter's line, which Rules shows under The console. Gigabytes as
   * Cloudflare bills them, a thousand million bytes.
   */
  storage: (held: number, share: number) =>
    `Photos and referral cards: ${(held / 1e9).toFixed(2)} GB of ${String(share / 1e9)} GB`,
  /** No board draws this line either. Megabytes as Cloudflare counts them, a million bytes. */
  database: (held: number, limit: number) => `Database: ${(held / 1e6).toFixed(0)} MB of ${String(limit / 1e6)} MB`,
  // No board draws the tabs' names.
  tabs: {
    rules: "Policies",
    blackouts: "Closed days",
    consumables: "Consumables",
    "job-sheet": "Job sheet",
  },
  /**
   * Our words, all of them: no board draws discount codes (docs/decisions/0108-discount-codes.md).
   * What a code takes off is shown before it is made, as a price is set
   * (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
   */
  discountCodes: {
    title: "Discount codes",
    note:
      "A code takes money off a first fit, a service visit or a replacement, before GST. The client enters it where " +
      "they pay or book, the technician before sending a payment link, ops on a visit. It is never taken on a free " +
      "service visit, and once a visit is paid for or invoiced its code stays as it is.",
    make: "Make codes",
    how: "The code",
    typed: "Type one",
    generated: "Generate them",
    code: "Code",
    codeHint: "4 to 16 letters and figures.",
    count: "How many",
    countHint: (most: number) => `1 to ${String(most)}. More than one makes each a single-use code.`,
    takesOff: "Takes off",
    percent: "A percentage",
    amount: "An amount",
    value: "Per cent",
    rupeesOff: "Rupees",
    cap: "At most, in rupees",
    capHint: "Optional. Leave empty for no cap.",
    covers: "Covers",
    coverNames: {
      first_fit: "First fit, and the consultation and fit in one visit",
      service: "Service visits",
      replacement: "Replacements",
    } as Readonly<Record<string, string>>,
    expires: "Last day it may be used",
    expiresHint: "Optional. Leave empty for no end.",
    maxUses: "Total uses",
    maxUsesHint: "Optional. Leave empty for no limit.",
    oncePerClient: "Once per client",
    check: "Check",
    checkTitle: "Make these codes?",
    send: "Make them",
    sending: "Making",
    back: "Back",
    /** One line of the check: what each code takes off. */
    off: (what: string) => `Takes off ${what} before GST`,
    percentOff: (percent: number, cap: string | null) =>
      cap === null ? `${String(percent)}%` : `${String(percent)}%, at most ${cap}`,
    covering: (kinds: string) => `On ${kinds}`,
    until: (day: string | null) => (day === null ? "No end date" : `Ends ${day}`),
    usesLine: (uses: number | null, once: boolean) =>
      `${uses === null ? "Any number of uses" : `${String(uses)} ${uses === 1 ? "use" : "uses"} in all`}${once ? ", once per client" : ""}`,
    oneTyped: (code: string) => `The code ${code}`,
    manyGenerated: (count: number) => `${String(count)} codes, generated, each used once`,
    oneGenerated: "One code, generated",
    made: (codes: readonly string[]) => `Made: ${codes.join(", ")}`,
    /** Codes are found by how they begin, so "SPR" finds SPRTEST. */
    find: "Find codes that begin with",
    findButton: "Find",
    showAll: "Show the latest",
    none: "No code yet.",
    noneFound: "No code begins with that.",
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
      `No booking takes it from now on. ${String(uses)} ${uses === 1 ? "booking keeps" : "bookings keep"} it, as sold.`,
    switching: "Switching off",
    errors: {
      not_permitted: NOT_PERMITTED,
      code: "A code is 4 to 16 letters and figures, with no spaces or signs.",
      count: "A code you type is made once. Generate them to make more.",
      value: "A percentage is 1 to 100. An amount is whole rupees.",
      cap: "Only a percentage takes a cap, in whole rupees.",
      covers: "Choose what the code covers.",
      expires_on: "The last day cannot be before today.",
      max_uses: "Generated codes are single-use: one use each.",
      code_exists: "A code with that text exists already.",
      not_found: "That code is gone. Reload to see the list as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  rules: {
    title: "Policies",
    // No board draws the rules' sections, nor the links between them.
    groups: {
      moves: "Moves, cancels and no-shows",
      booking: "Booking and payment",
      field: "Visits in the field",
      reminders: "Reminders and replacements",
      referrals: "Referrals",
      console: "The console",
      other: "Other policies",
    },
    jump: "Policies by subject",
    lateFees: "Late fees are set in Prices",
    allowed: (min: number, max: number, unit: string) => `${String(min)} to ${String(max)} ${unit}, a whole number`,
    /** An hour of the day, typed on a 24-hour clock and read as "6 pm". */
    allowedHours: (min: string, max: string) => `An hour from ${min} to ${max}, typed on a 24-hour clock`,
    hour: (hour: number) => {
      if (hour === 0) return "midnight";
      if (hour === 12) return "noon";
      return hour < 12 ? `${String(hour)} am` : `${String(hour - 12)} pm`;
    },
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    /** A figure typed outside its bounds, said in the hint's place, since it leaves Save with nothing to send. */
    outOfBounds: (min: string, max: string) => `Enter a whole figure from ${min} to ${max}.`,
    committed: "Nobody has set this, so the standard figure stands.",
    save: "Save",
    saving: "Saving",
    saved: "Saved.",
    reset: "Go back to the standard figure",
    /** The open-keyed rule's extra row: a base, and the cycle for it. */
    keyName: "Base, exactly as the technician records it",
    keyValue: "Days",
    add: "Add",
    defaultKey: "Every other base",
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
      no_show_waiver: { payment: "The visit's payment", credit: "The free service visit it used" },
      task_sla_hours: tasks.groups,
      // The phone's two bounds (docs/decisions/0088-every-policy-in-the-console.md).
      phone_clock: {
        before_start: "Earliest check-in, before the booked start",
        held_offline: "Longest a phone may stay offline",
      },
      // Board C4's countdown and the grace after it (docs/decisions/0068-a-paid-hold-is-kept.md).
      payment_hold: {
        countdown: "The countdown the client sees",
        grace: "Grace after the countdown",
      },
      // Board D3's two figures (docs/open-points.md, item 59).
      technician_work: {
        period: "Figures counted over",
        over_by: "Running over from",
      },
      // The days the next visit turns on (docs/decisions/0086-the-next-visit-is-offered.md).
      booking_days: {
        first_fit_lead: "From a consultation to the first fit",
        service_cadence: "Between service visits",
        reminder_before_due: "Reminder, before the next service is due",
        at_risk_after_due: "At-risk client, after it was due",
        first_fit_to_book: "First fit to book, after the consultation",
        horizon: "How far ahead a visit may be booked",
        invoice_prompt: "A new invoice on Home",
        replacement_order_lead: "Replacement order, before the hair system is due",
      },
      // What a referral earns, each side apart (docs/decisions/0107-referral-rewards-in-the-console.md).
      referral_reward: {
        referrer_visits: "The client who sent the invite",
        friend_visits: "The friend they invited",
        valid_days: "The free service visits last",
      },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /**
     * Each choice a rule of choices offers, in the console's words, by the rule's name
     * (docs/decisions/0088-every-policy-in-the-console.md).
     */
    choiceNames: {
      late_change_charge: { nothing: "Nothing", late_fee: "Its late fee", visit: "The visit itself" },
      no_show_charge: { nothing: "Nothing", late_fee: "Its late fee", visit: "The visit itself" },
      no_show_waiver: { refunded: "Refunded", kept: "Kept", returned: "Returned", spent: "Spent" },
    } as Readonly<Record<string, Readonly<Record<string, string>>>>,
    /**
     * The check before a rule is sent, as a price's (docs/decisions/0071-what-ops-see-before-a-setting-
     * changes.md): each figure that moves, the old beside the new.
     */
    confirm: {
      title: "Check the change",
      change: (label: string, was: string, now: string) => `${label}: ${was} → ${now}.`,
      /** A figure as the check writes it: "200 metres". */
      figure: (value: number, unit: string) => `${String(value)} ${unit}`,
      /** A base ops are naming for the first time had no figure of its own. */
      noFigure: "none",
      /** A base whose own figure is taken away takes the one for every other base. */
      otherBases: "the figure for every other base",
      /** A box of a rule with many, named with its rule: "No-show wait · First fit". */
      keyed: (rule: string, box: string) => `${rule} · ${box}`,
      standard: (rule: string) => `This puts the standard figures back for ${rule}.`,
      send: "Save",
      back: "Change it",
    },
    /**
     * The rule's name, or one of its boxes, and what the API said of it. A section's Save sends its rules one by one,
     * so a refusal speaks for its own rule only.
     */
    outside: (field: string) => `${field} is outside what this rule allows, so it was not saved.`,
    errors: {
      not_permitted: NOT_PERMITTED,
      invalid_request: "That figure is outside what this rule allows, so it was not saved.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through, so this rule was not saved.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Our words, all of them: no board draws the days no visit is offered, which the runbook's SQL set before
   * (docs/decisions/0088-every-policy-in-the-console.md).
   */
  blackouts: {
    title: "Closed days",
    /** Followed by a link to the dispatch board. */
    note:
      "Days no visit is offered, in the app or from the site. Blacking out a day moves no visit already booked on " +
      "it: move those on",
    board: "the dispatch board",
    from: "First day",
    to: "Last day",
    reason: "Why",
    add: "Black out these days",
    adding: "Adding",
    added: "Added.",
    none: "No day is blacked out.",
    /** "Tue 20 Oct to Thu 22 Oct", and "Tue 20 Oct" for one day. */
    period: (from: string, to: string) => (from === to ? from : `${from} to ${to}`),
    setBy: (who: string, when: string) => `Added by ${who} on ${when}`,
    unrecorded: "Added before this screen, so who added it is not recorded.",
    booked: (visits: number) =>
      `${String(visits)} ${visits === 1 ? "visit is" : "visits are"} still booked on these days. Move ${
        visits === 1 ? "it" : "them"
      } on the dispatch board.`,
    show: "Show on board",
    /** The link's whole name, since the list holds many and each link says the same. */
    showLabel: (period: string) => `Show on board: ${period}`,
    remove: "Offer these days again",
    /** The button's whole name, since the list holds many and each button says the same. */
    removeLabel: (period: string) => `Offer ${period} again`,
    removing: "Offering them again",
    errors: {
      not_permitted: NOT_PERMITTED,
      from: "The first day cannot be before today.",
      to: "The last day cannot come before the first, and one go covers a month at most.",
      reason: "Say why, in letters and figures, up to 60 of them.",
      not_found: "Those days are no longer blacked out. Reload to see the list as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Our words, all of them: no board draws the services (docs/decisions/0085-services-ops-can-edit.md). A kind
   * of visit is code; the services within it are ops', each named, timed, priced, ordered and retired from a day
   * here, and each is invoiced in Books on an item of its own. What a price or a change was is shown beside what it will
   * be before anything is sent (docs/decisions/0071-what-ops-see-before-a-setting-changes.md).
   */
  services: {
    title: "Services and prices",
    note:
      "What clients can book, kind by kind. A new price applies from tomorrow at the earliest, so a price already " +
      "quoted never moves. Each service is invoiced in Books on an item of its own.",
    /** The four kinds, as the rest of the console names them. */
    kinds: dispatch.typeNames,
    /** Under First fit: its services are the hair systems clients choose from, and nothing stands in for them. */
    hairSystems:
      "Clients book a first fit only as one of these hair systems, by its name, description and price here. With " +
      "none offered and priced, first fits and the consultation and fit in one visit cannot be booked.",
    /** "180 minutes · code premium": how long it is held and booked for, and what the price book prices it by. */
    facts: (minutes: number, tier: string) => `${String(minutes)} minutes · code ${tier}`,
    /** The line clients read under the service's name in the app as they choose. */
    described: (line: string) => `Clients read: “${line}”`,
    notDescribed: "No description, so clients read the name alone.",
    offered: "Offered",
    retiring: (from: string) => `Clients stop seeing it from ${from}`,
    retired: (from: string) => `Retired from ${from}`,
    /** Under a service, what it costs today, and what it will from a later day. */
    now: (price: string, since: string) => `Now ${price}, since ${since}.`,
    unpriced: "No price yet, so clients do not see it.",
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
    lateFeeNote: "Charged for a late move or cancel, where the rules charge this kind its late fee.",
    /** The link to the rule that says when a late fee is charged. */
    lateFeeRule: "Set when it applies",
    actions: {
      price: "Change price",
      correct: "Correct",
      takeBack: "Take back",
      rename: "Rename",
      describe: "Change description",
      length: "Change length",
      retire: "Retire",
      restore: "Restore",
      up: "Move up",
      down: "Move down",
      add: (kind: string) => `Add a service to ${kind}`,
      addHairSystem: "Add a hair system",
    },
    /** Each button named for a screen reader with what it acts on. */
    labels: {
      price: (name: string) => `Change the price of ${name}`,
      correct: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      takeBack: (name: string, from: string) => `Take back the ${name} price from ${from}`,
      rename: (name: string) => `Rename ${name}`,
      describe: (name: string) => `Change the description of ${name}`,
      length: (name: string) => `Change the length of ${name}`,
      retire: (name: string) => `Retire ${name}`,
      restore: (name: string) => `Restore ${name}`,
      up: (name: string) => `Move ${name} up`,
      down: (name: string) => `Move ${name} down`,
    },
    form: {
      priceTitle: (name: string) => `A new price for ${name}`,
      correctTitle: (name: string, from: string) => `Correct the ${name} price from ${from}`,
      amount: "Price before GST, in rupees",
      amountHint: (max: string) => `Whole rupees, up to ${max}.`,
      gst: "GST",
      gstHint: (max: number) => `A whole percentage, 0 to ${String(max)}.`,
      from: "Applies from",
      fromHint: "Tomorrow or later.",
      /** A day typed before tomorrow, said beside the box before anything is checked. */
      fromTooSoon: "Choose tomorrow or a later day. A price never changes what is sold today.",
      setPrice: "Set this price",
      renameTitle: (name: string) => `Rename ${name}`,
      name: "Name",
      nameHint: "What clients and ops call it. A letter or a digit first.",
      describeTitle: (name: string) => `The description of ${name}`,
      description: "Description",
      descriptionHint: (max: number) =>
        `One line clients read under its name as they choose: what sets it apart. Up to ${String(max)} characters. ` +
        "Leave it empty to show none.",
      lengthTitle: (name: string) => `The length of ${name}`,
      minutes: "Length, in minutes",
      minutesHint: (min: number, max: number) =>
        `Whole minutes, ${String(min)} to ${String(max)}. The day keeps this long for each visit.`,
      retireTitle: (name: string) => `Retire ${name}`,
      retireFrom: "Clients stop seeing it from",
      retireHint: "Today or a day after it. Visits already sold stay as they were sold.",
      addTitle: (kind: string) => `A new service of ${kind}`,
      code: "Code",
      codeHint: "The price book prices the service by it, and it never changes. Made from the name.",
      next: "Check the change",
      cancel: "Cancel",
    },
    /** The check before anything is sent: what it is now, and what it will be. */
    check: {
      title: "Check the change",
      price: (name: string, was: string, now: string, from: string) => `${name}: ${was} → ${now}, from ${from}.`,
      correct: (name: string, was: string, wasFrom: string, now: string, from: string) =>
        `${name}: ${was} from ${wasFrom} → ${now} from ${from}.`,
      nothing: "nothing",
      gstChanges: (was: number, now: number) => `GST changes from ${String(was)}% to ${String(now)}%.`,
      sameDay: "A price is already set from that day. This replaces it.",
      rename: (was: string, now: string, tier: string) =>
        `${was} → ${now}. Its code stays ${tier}, and with it every price it has and every visit sold.`,
      describe: (name: string, was: string, now: string) =>
        `${name}: ${descriptionWords(was)} → ${descriptionWords(now)}`,
      length: (name: string, was: number, now: number) =>
        `${name}: ${String(was)} → ${String(now)} minutes. A visit held or booked before keeps its own length.`,
      retire: (name: string, from: string) =>
        `Clients stop seeing ${name} from ${from}. Visits already sold stay as they were sold.`,
      restore: (name: string) => `Offer ${name} again. Its prices are as they were.`,
      order: (kind: string, was: string, now: string) => `${kind}: ${was} → ${now}.`,
      add: (kind: string, name: string, minutes: number, tier: string) =>
        `Add ${name} to ${kind}: ${String(minutes)} minutes, code ${tier}. Clients see it once it has a price.`,
      takeBack: (from: string) => `Take back the price from ${from}? The price before it goes on applying.`,
      send: "Save it",
      back: "Change it",
      takeBackConfirm: "Take it back",
      keep: "Keep it",
    },
    saving: "Saving",
    done: {
      price: "The price is set.",
      takenBack: "The price is taken back.",
      saved: "Saved.",
    },
    /** A refusal names the box it came from (src/routes/ops/services.ts, ops-settings.ts); these are said of each. */
    errors: {
      not_permitted: NOT_PERMITTED,
      tier: "No service of this kind has that code, or a code cannot be made from that name. Nothing was changed.",
      name: "A name starts with a letter or a digit, runs from 2 to 60 characters, and opens no formula. Nothing was changed.",
      description: "A description is one line, up to the length under the field. Nothing was changed.",
      minutes: "A length is whole minutes, inside the range under the field. Nothing was changed.",
      retired_date:
        "A service retires from today or a day after it, and one already retired is restored first. Nothing was changed.",
      order: "The order has changed since the page was read. Reload to see it as it stands.",
      amount_ex_gst: "A price is in whole rupees, inside the range under the field. Nothing was changed.",
      gst_percent: "GST is a whole percentage, inside the range under the field. Nothing was changed.",
      valid_from: "A new price applies from tomorrow at the earliest. Nothing was changed.",
      was_valid_from: "That price applies already, so it stays in the book.",
      service_exists: "Another service already has that name, or this kind that code. Nothing was changed.",
      last_of_kind:
        "A consultation, a service visit and a replacement each keep one service that is never retired and has a " +
        "price, so clients can always book them. Add and price the one that replaces it first.",
      service_retired: "The service is retired by that day, so it takes no price from then. Nothing was changed.",
      not_found: "That is no longer in the console. Reload to see it as it stands.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
    /** Taking back a price that applies already, or has applied: it may stand on an invoice. */
    takeBackErrors: {
      not_permitted: NOT_PERMITTED,
      valid_from: "That price applies already, so it stays in the book.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Every word of the consumables and of each service's expected
   * use. No board draws them; the owner ruled on 27 September 2026 that both
   * are set here (docs/decisions/0087-consumables-and-stock.md).
   */
  consumables: {
    title: "Consumables",
    note: "What a technician may record using on a job, and what one costs us. The cost is ours alone: no client's invoice carries it.",
    columns: ["Consumable", "Cost of one", "Low at", "State"],
    none: "No consumables yet. Add the first below.",
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
      nameHint: "As the technician reads it: a letter or a digit first.",
      unit: "Unit",
      unitHint: "What one is counted in: strip, ml, sachet.",
      cost: "Cost of one, in rupees",
      costHint: (max: string) => `Up to ${max}, to the paisa. Ours alone: no invoice carries it.`,
      kit: "A kit is low at",
      central: "The central store is low at",
      levelHint: "In its unit. Leave it empty for no alert.",
      add: "Add this consumable",
      save: "Save the change",
      saving: "Saving",
      cancel: "Not now",
      added: "The consumable is added. The technician app offers it from now.",
      saved: "The change is saved.",
      /** The check before anything is sent, the old beside the new. */
      confirm: {
        title: "Check the change",
        adding: (name: string, unit: string, cost: string) => `${name}, counted in ${unit}, at ${cost} each.`,
        line: (field: string, was: string, now: string) => `${field}: ${was} → ${now}`,
        fields: { name: "Name", unit: "Unit", cost: "Cost of one", kit: "Kit low at", central: "Store low at" },
        noLevel: "no level",
        send: "Save it",
        back: "Change it",
        nothing: "Nothing has changed.",
      },
    },
    retiring: {
      title: (name: string) => `Retire ${name}`,
      from: "No longer offered from",
      fromHint: "Today or a day after it. What was recorded stays, and so does its stock.",
      question: (name: string, from: string) =>
        `The technician app stops offering ${name} from ${from}. A job that already recorded it keeps it.`,
      send: "Retire it",
      restore: (name: string) => `Offer ${name} to the technician app again?`,
      restoreSend: "Restore it",
      done: "Done.",
    },
    usage: {
      title: "What each service uses",
      note: "The technician's steppers start at these on a job of the service. He can change them, and add any other consumable.",
      service: "Service",
      /** A service by its name, as the console names it; "Lace replacement, retired from 1 Oct 2027" once retired. */
      serviceName: (name: string, retiredFrom: string | null) =>
        retiredFrom === null ? name : `${name}, retired from ${retiredFrom}`,
      quantity: (name: string, unit: string) => `${name}, ${unit} a visit`,
      quantityHint: (max: number) => `A whole number up to ${String(max)}. Leave it empty if the service uses none.`,
      noneOffered: "Add a consumable above before setting what a service uses.",
      save: "Save this service's use",
      confirm: {
        title: "Check the change",
        line: (name: string, was: string, now: string) => `${name}: ${was} → ${now}`,
        none: "none",
        send: "Save it",
        back: "Change it",
        nothing: "Nothing has changed.",
      },
      saved: "Saved. The technician app reads it with the next job it opens.",
    },
    /** A refusal, said of the box it names (src/routes/ops/consumables.ts). */
    errors: {
      not_permitted: NOT_PERMITTED,
      name: "Another consumable has that name, or it does not start with a letter or a digit. Nothing was changed.",
      unit: "A unit is a word of letters: strip, ml, sachet. Nothing was changed.",
      unit_cost: "The cost is in rupees, inside the range under the field. Nothing was changed.",
      reorder_kit: "A level is a whole number, or empty. Nothing was changed.",
      reorder_central: "A level is a whole number, or empty. Nothing was changed.",
      from: "A consumable is retired from today or a day after it. Nothing was changed.",
      tier: "The console no longer holds that service. Nothing was changed.",
      items: "That names a consumable nobody added, or one twice. Nothing was changed.",
      not_found: "That consumable is not in the list any more. Reload the page.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Every word of the job sheet the technician app reads: each
   * kind of visit's checklist and the partial reasons (docs/open-points.md,
   * item 28). No board draws it.
   */
  jobSheet: {
    title: "Job sheet",
    note: "What the technician ticks on each kind of visit, and the reasons he may pick when a job is left partly done. His phone reads them with each job it opens; a job already on it keeps the list it was given.",
    kind: "Kind of visit",
    checklist: (type: string) => `${type} checklist`,
    reasons: "Partial reasons",
    reasonsNote: "These drive the Tasks board: a job left partly done waits there with its reason.",
    item: (position: number) => `Item ${String(position)}`,
    reason: (position: number) => `Reason ${String(position)}`,
    /** The buttons beside an item: each names the item after what it does, so a screen reader says which. */
    upButton: "Move up",
    up: (label: string) => `Move up: ${label}`,
    downButton: "Move down",
    down: (label: string) => `Move down: ${label}`,
    removeButton: "Take off",
    remove: (label: string) => `Take off: ${label}`,
    unnamed: "the empty item",
    add: "Add an item",
    addReason: "Add a reason",
    retired: "Taken off",
    retiredNote: "A phone that recorded one of these before it was taken off is still understood.",
    putBack: (label: string) => `Put back: ${label}`,
    putBackButton: "Put back",
    committed: "Nobody has set this, so the standard list stands.",
    setBy: (who: string, when: string) => `Set by ${who} on ${when}`,
    hint: (most: number, longest: number) =>
      `At least one, at most ${String(most)}, each up to ${String(longest)} characters and no two alike.`,
    save: "Save this list",
    saving: "Saving",
    saved: "Saved. Each phone reads it with the next job it opens.",
    confirm: {
      title: "Check the change",
      was: "Was",
      now: "Now",
      added: (label: string) => `Added: ${label}`,
      renamed: (was: string, now: string) => `Renamed: ${was} → ${now}`,
      takenOff: (label: string) => `Taken off: ${label}`,
      moved: "The order changes.",
      send: "Save it",
      back: "Change it",
      nothing: "Nothing has changed.",
    },
    errors: {
      not_permitted: NOT_PERMITTED,
      items: "A list holds at least one item and no more than the limit under it. Nothing was changed.",
      label: "Each item needs words, no longer than the limit, and no two alike. Nothing was changed.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
  },
  /**
   * Our words, all of them: no board draws the Staff page. A change is shown before it is saved.
   */
  staff: {
    title: "Staff",
    note:
      "Who may use the console, and for what. Each grant gives one department at one level, nationally, across a " +
      "zone or in one city. View sees; Act does the day's work; Manage also refunds, waives, sets prices, codes and " +
      "settings, deletes accounts and grants access.",
    departments: DEPARTMENT_NAMES,
    levels: { view: "View", act: "Act", manage: "Manage" },
    national: "National",
    zone: (name: string) => `${name} zone`,
    zones: "Zones",
    cities: "Cities",
    grant: (department: string, level: string, place: string) => `${department} · ${level} · ${place}`,
    columns: { person: "Person", access: "Access", state: "Status" },
    noAccess: "No access yet",
    active: "Let in",
    inactive: "Switched off",
    add: "Add a person",
    change: "Change",
    changeLabel: (email: string) => `Change ${email}`,
    form: {
      addTitle: "Add a person",
      changeTitle: (email: string) => `Change ${email}`,
      email: "Sign-in e-mail",
      emailHint: "The address they sign in to the console with.",
      letIn: "Let them in",
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
      title: "Check the change",
      adds: (email: string) => `Adds ${email}.`,
      letsIn: "Lets them in again.",
      switchesOff: "Switches them off: the console closes to them.",
      gives: (grant: string) => `Gives ${grant}`,
      takes: (grant: string) => `Takes away ${grant}`,
      nothing: "Nothing has changed.",
      send: "Save it",
      sending: "Saving",
      back: "Change it",
    },
    saved: "Saved.",
    errors: {
      email: "Enter the e-mail they sign in with.",
      already_listed: "This person is already on the list. Use Change beside their e-mail.",
      place: "Choose where this access applies.",
      grants: "Give each department once for each place.",
      not_permitted: "You can grant access only within your own area, and only with Admin · Manage.",
      last_admin: "Someone must keep Admin · Manage nationally. Give it to another person first.",
      offline: "You are offline. Connect, then try again.",
      unknown: "That did not go through. Nothing was changed.",
    } as Readonly<Record<string, string>>,
    enforcement: {
      title: "Access control",
      off:
        "Not enforced yet. Everyone Access lets in can open every section, and each call this list would refuse is " +
        "logged. Check the list, then start enforcing.",
      on: "Enforced. People open only the departments and places granted here; anyone not listed sees nothing.",
      setBy: (who: string, when: string) => `Switched by ${who} on ${when}`,
      start: "Start enforcing",
      stop: "Stop enforcing",
      startTitle: "Start enforcing access?",
      startLine: "From now on, only the people listed here can use the console, and only as granted.",
      stopTitle: "Stop enforcing access?",
      stopLine: "Everyone Access lets in will open every section again.",
      sending: "Saving",
      back: "Go back",
      onlyNational: "Only someone with Admin · Manage nationally can switch this.",
      errors: {
        not_permitted: "Only someone with Admin · Manage nationally can switch this.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was changed.",
      } as Readonly<Record<string, string>>,
    },
    tokens: {
      title: "Service tokens",
      note:
        "Automated access, such as the test runner's. A token listed here can do everything except grant access; " +
        "one not listed is refused once access is enforced.",
      none: "No service token is listed.",
      addedBy: (who: string, when: string) => `Added by ${who} on ${when}`,
      clientId: "Client ID",
      clientIdHint: "From Cloudflare Access, under Service credentials.",
      label: "Name",
      add: "Add the token",
      adding: "Adding",
      remove: "Remove",
      removeLabel: (label: string) => `Remove ${label}`,
      removeTitle: (label: string) => `Remove ${label}?`,
      removeLine: "Whatever uses it is refused once access is enforced.",
      removing: "Removing",
      back: "Keep it",
      onlyNational: "Only someone with Admin · Manage nationally can change service tokens.",
      errors: {
        client_id: "Paste the client ID exactly as Cloudflare Access shows it.",
        label: "Give it a short name.",
        not_found: "That token is no longer listed. Reload to see the list as it stands.",
        not_permitted: "Only someone with Admin · Manage nationally can change service tokens.",
        offline: "You are offline. Connect, then try again.",
        unknown: "That did not go through. Nothing was changed.",
      } as Readonly<Record<string, string>>,
    },
  },
} as const;

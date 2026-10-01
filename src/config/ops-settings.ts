// The business inputs ops set for themselves, and the bounds they set them
// within (docs/decisions/0061-ops-editable-inputs.md).
//
// Each entry names the number's unit, what it may be, and the committed value
// it falls back to. The committed value stays where it always was -- in
// src/policy/ beside the rule it belongs to, or in src/config/ -- so the rules
// still read as rules and test/node/policy-quotes.test.ts still holds them to
// the prompt word for word. This file says which of those numbers ops may
// change and how far, and nothing else.
//
// Prices, their GST and the service area are not here. They have dated tables
// of their own (price_book, serviceable_pincodes) because a document already
// issued depends on what was true then; the ADR gives the split.

import { CHECKIN_RADIUS_M } from "../policy/check-in.ts";
import { FSM_RETRY, FSM_RETRY_KEYS } from "../policy/held-bookings.ts";
import { DAY_BEFORE_REMINDER_HOUR, UNLOCK_HOUR } from "../policy/job-visibility.ts";
import { NEXT_VISIT_DAY_BOUNDS, NEXT_VISIT_DAY_KEYS, NEXT_VISIT_DAYS } from "../policy/next-visit.ts";
import { chargesFor, FREE_CHANGE_NOTICE_HOURS, LATE_CHANGE_CHARGES } from "../policy/moving-a-visit.ts";
import { NO_SHOW_CHARGES, NO_SHOW_WAIT_MIN, WAIVER_GIVES_BACK, WAIVER_KEYS } from "../policy/no-show.ts";
import { PHONE_CLOCK, PHONE_CLOCK_KEYS } from "../policy/phone-clock.ts";
import { MAX_REWARD_VISITS, REFERRAL_REWARD, REFERRAL_REWARD_KEYS } from "../policy/referral-reward.ts";
import { TECHNICIAN_WORK, TECHNICIAN_WORK_KEYS } from "../policy/technician-work.ts";
import { TASK_GROUPS, TASK_SLA_HOURS } from "../policy/tasks.ts";
import { DEFAULT_PIECE_CYCLE_DAYS, PIECE_CYCLE_DAYS } from "./pieces.ts";
import { PAYMENT_HOLD, PAYMENT_HOLD_KEYS } from "./scheduling.ts";
import { VISIT_TYPES } from "./visit-types.ts";

/** One number, or one per key; or, for a rule of choices, one choice per key. */
export type SettingValue = number | Readonly<Record<string, number>> | Readonly<Record<string, string>>;

/** What one figure may be, and what it counts where that is not what the rule's other figures count. */
export interface KeyBounds {
  readonly min: number;
  readonly max: number;
  readonly unit?: string;
}

interface Described {
  readonly name: string;
  /** What ops read above the field. */
  readonly title: string;
  /** Why it matters, in the words a non-developer needs to set it. */
  readonly note: string;
  /** The module the fallback lives in, so the figure can be found in the code. */
  readonly source: string;
}

/** A rule whose figures are numbers: a radius, a wait, an hour, a number of days. */
export interface NumberSetting extends Described {
  /** What the number counts: metres, minutes, hours, days, or the hour of the day. */
  readonly unit: string;
  /** What every figure may be; where a keyed input's figures differ, the widest, with each key's own in `bounds`. */
  readonly min: number;
  readonly max: number;
  /**
   * Each key's own bounds, for a closed set whose figures measure different things, as the days of `booking_days`
   * do, or count in another unit, as the phone's clock bounds do; left out where every key takes `min` to `max`.
   */
  readonly bounds?: Readonly<Record<string, KeyBounds>>;
  /**
   * null for one number. A list of keys where the set is closed, as the visit
   * types and the task groups are. "open" where ops name the keys themselves:
   * a piece base is whatever FSM's part item is called, so the set cannot be
   * known here, and the key `default` then stands for every base without one.
   */
  readonly keys: readonly string[] | "open" | null;
  /** In force while the store holds no row, or cannot be read. */
  readonly fallback: number | Readonly<Record<string, number>>;
}

/**
 * A rule whose figures are choices, one per key of a closed set: what each kind of visit costs, or what a waiver
 * gives back. Each key takes one of its own choices, so a kind with no late fee is never offered one.
 */
export interface ChoiceSetting extends Described {
  readonly keys: readonly string[];
  readonly choices: Readonly<Record<string, readonly string[]>>;
  /** In force while the store holds no row, or cannot be read. */
  readonly fallback: Readonly<Record<string, string>>;
}

export type OpsSetting = NumberSetting | ChoiceSetting;

export const isChoice = (setting: OpsSetting): setting is ChoiceSetting => "choices" in setting;

/** The key an open-keyed input must always carry: the figure every other key falls back to. */
export const DEFAULT_KEY = "default";

export const OPS_SETTINGS = [
  {
    name: "checkin_radius_m",
    title: "Check-in radius",
    note: "How close to the address a technician must be for “I have arrived” to pass. Every check-in records the distance it measured and the radius in force, whether it passed or not, so this can be tuned from real arrivals.",
    unit: "metres",
    min: 50,
    max: 1000,
    keys: null,
    fallback: CHECKIN_RADIUS_M,
    source: "src/policy/check-in.ts",
  },
  {
    name: "no_show_wait_min",
    title: "No-show wait",
    note: "How long a technician waits, from check-in, before they may close a job as a no-show. One figure per kind of visit.",
    unit: "minutes",
    min: 5,
    max: 120,
    keys: VISIT_TYPES,
    fallback: NO_SHOW_WAIT_MIN,
    source: "src/policy/no-show.ts",
  },
  {
    // The owner's terms of 27 September 2026 (docs/open-points.md, item 7), which a booking keeps as it was made under.
    name: "change_notice_hours",
    title: "Free to move or cancel until",
    note: "How long before a visit's window moving or cancelling it stops being free. Inside it, each kind of visit costs what is set below. A booking keeps the terms it was made under, and a move ops make never costs the client anything.",
    unit: "hours before the window",
    min: 1,
    max: 168,
    keys: null,
    fallback: FREE_CHANGE_NOTICE_HOURS,
    source: "src/policy/moving-a-visit.ts",
  },
  {
    name: "late_change_charge",
    title: "What a late move or cancel costs",
    note: "What each kind of visit costs when the client moves or cancels it inside that notice: nothing, its late fee, which is a price in Services and prices, or the visit itself, whose payment is kept or whose credit is spent. A late fee is offered only for a kind that has one.",
    keys: VISIT_TYPES,
    choices: Object.fromEntries(VISIT_TYPES.map((type) => [type, chargesFor(type)])),
    fallback: LATE_CHANGE_CHARGES,
    source: "src/policy/moving-a-visit.ts",
  },
  {
    // Item 60 of docs/open-points.md: set apart from the late-cancel terms, so either can change alone.
    name: "no_show_charge",
    title: "What a no-show costs",
    note: "What each kind of visit costs when you charge a no-show, set apart from a late cancel so either can change alone: its late fee kept from what was paid and the rest refunded, the visit kept or its credit spent, or nothing. Each booking keeps what was set when it was made.",
    keys: VISIT_TYPES,
    choices: Object.fromEntries(VISIT_TYPES.map((type) => [type, chargesFor(type)])),
    fallback: NO_SHOW_CHARGES,
    source: "src/policy/no-show.ts",
  },
  {
    name: "no_show_waiver",
    title: "What waiving a no-show gives back",
    note: "When you waive a no-show, whether the visit's payment is refunded and whether its visit credit is returned. The client's message says which, and each ruling keeps what it gave.",
    keys: WAIVER_KEYS,
    choices: { payment: ["refunded", "kept"], credit: ["returned", "spent"] },
    fallback: WAIVER_GIVES_BACK,
    source: "src/policy/no-show.ts",
  },
  {
    name: "address_unlock_hour",
    title: "When a job's address unlocks",
    note: "The hour on the day before a visit when the technician's phone may show the address, the access notes and the client card. It is a privacy boundary: it keeps a whole day's client list off a phone that might be lost.",
    unit: "hour of the day, in India",
    min: 0,
    max: 23,
    keys: null,
    fallback: UNLOCK_HOUR,
    source: "src/policy/job-visibility.ts",
  },
  {
    name: "reminder_hour",
    title: "When reminders go",
    note: "The hour from which the WhatsApp reminder of tomorrow's visit goes, and the reminder of a next service falling due. The address unlocks at its own hour, so moving one does not move the other.",
    unit: "hour of the day, in India",
    // Not in the night: a message about a visit wakes nobody.
    min: 8,
    max: 21,
    keys: null,
    fallback: DAY_BEFORE_REMINDER_HOUR,
    source: "src/policy/job-visibility.ts",
  },
  {
    // The owner's three bounds on the phone's clock (docs/open-points.md, item 58). The third, that the no-show wait
    // runs on our clock too, is the wait above, measured from when the check-in reached us.
    name: "phone_clock",
    title: "How far a phone is trusted about time",
    note: "How long before the booked start a check-in may say the technician arrived, and how long a phone may hold something done without signal and still have its time believed. A time earlier than either is taken as the bound. The no-show wait also runs from when a check-in reaches us, whatever time the phone gave it.",
    unit: "minutes",
    min: 0,
    max: 240,
    keys: PHONE_CLOCK_KEYS,
    bounds: {
      before_start: { min: 0, max: 240 },
      // A day covers any genuine replay, since the app keeps today's and tomorrow's jobs; three at the most.
      held_offline: { min: 1, max: 72, unit: "hours" },
    },
    fallback: PHONE_CLOCK,
    source: "src/policy/phone-clock.ts",
  },
  {
    name: "task_sla_hours",
    title: "How long a task may wait",
    note: "How long each queue on the Tasks board has before it counts as overdue. Its own section counts down to the same day.",
    unit: "hours",
    min: 1,
    // A month, so the 30 days the app promises a grievance its answer within can stand (src/policy/tasks.ts).
    max: 720,
    keys: TASK_GROUPS,
    fallback: TASK_SLA_HOURS,
    source: "src/policy/tasks.ts",
  },
  {
    name: "piece_cycle_days",
    title: "Replacement cycle",
    note: "How long a piece on each base lasts before it is due for replacement. Name a base exactly as FSM's part item names it; every base without a figure of its own takes the figure for every other base.",
    unit: "days",
    min: 30,
    max: 1095,
    keys: "open",
    fallback: { ...PIECE_CYCLE_DAYS, [DEFAULT_KEY]: DEFAULT_PIECE_CYCLE_DAYS },
    source: "src/config/pieces.ts",
  },
  {
    // Board C4's ten minutes, and the two minutes' grace of ADR 0025, ruling 42 (docs/decisions/0068-a-paid-hold-is-kept.md).
    name: "payment_hold",
    title: "Holding a slot while the client pays",
    note: "How long the app holds a slot while the client pays, which is the countdown they see, and how long after it a payment still counts as made in time, since a payment begun at the last moment lands a little later. A slot not paid for is free to others once both have passed. A hold keeps the figures it was made with.",
    unit: "minutes",
    min: 1,
    max: 30,
    keys: PAYMENT_HOLD_KEYS,
    bounds: {
      countdown: { min: 5, max: 30 },
      grace: { min: 1, max: 10 },
    },
    fallback: PAYMENT_HOLD,
    source: "src/config/scheduling.ts",
  },
  {
    // The owner's ruling of 27 September 2026 on a booking FSM refuses (docs/open-points.md, item 141).
    name: "fsm_retry",
    title: "Trying again a booking FSM refused",
    note: "When FSM has refused a booking five times running, its slot and its payment are kept and you are told once. It is then tried again this often, for this long after the fifth refusal, and after that waits for you on the Tasks board, to book in FSM or refund. A change reaches the bookings already waiting at their next try.",
    unit: "hours",
    min: 1,
    max: 168,
    keys: FSM_RETRY_KEYS,
    bounds: {
      every: { min: 1, max: 12 },
      // A week at the most: a booking FSM has refused that long needs ops, not another try.
      for: { min: 1, max: 168 },
    },
    fallback: FSM_RETRY,
    source: "src/policy/held-bookings.ts",
  },
  {
    // Board D3's two figures, the owner's of 27 September 2026 (docs/open-points.md, item 59).
    name: "technician_work",
    title: "The technicians' figures",
    note: "How many days back the Technicians screen counts each technician's jobs and average service, and how many minutes over the length the visits were planned for an average must run to be shown as running over.",
    unit: "days",
    min: 1,
    max: 365,
    keys: TECHNICIAN_WORK_KEYS,
    bounds: {
      period: { min: 7, max: 365 },
      over_by: { min: 1, max: 120, unit: "minutes" },
    },
    fallback: TECHNICIAN_WORK,
    source: "src/policy/technician-work.ts",
  },
  {
    // One input for the seven figures the next visit turns on (docs/decisions/0086-the-next-visit-is-offered.md).
    name: "booking_days",
    title: "Booking and the next visit",
    note: "When the app offers each next visit and how far ahead a client may book it, when the WhatsApp reminder of the next service goes while nothing is booked, when the Tasks board asks you to step in, and how long Home shows an invoice just issued. Each figure has its own range.",
    unit: "days",
    min: 0,
    max: 90,
    keys: NEXT_VISIT_DAY_KEYS,
    bounds: NEXT_VISIT_DAY_BOUNDS,
    fallback: NEXT_VISIT_DAYS,
    source: "src/policy/next-visit.ts",
  },
  {
    // The owner's ruling of 1 October 2026: each side's visits, and how long they last (ADR 0025, item 94).
    name: "referral_reward",
    title: "What a referral earns",
    note: "The free service visits the client who sent an invite gets, and those their friend gets, once the friend's first fit is done, and how long the credits last from then. Either side may get 0. A change reaches every friend fitted after it, and the site, the app and the WhatsApp messages say the new figures; credits already given keep their visits and their date.",
    unit: "service visits",
    min: 0,
    max: 1095,
    keys: REFERRAL_REWARD_KEYS,
    bounds: {
      referrer_visits: { min: 0, max: MAX_REWARD_VISITS },
      friend_visits: { min: 0, max: MAX_REWARD_VISITS },
      // A month at the least, since a service visit falls due monthly; three years at the most.
      valid_days: { min: 30, max: 1095, unit: "days" },
    },
    fallback: REFERRAL_REWARD,
    source: "src/policy/referral-reward.ts",
  },
] as const satisfies readonly OpsSetting[];

export type OpsSettingName = (typeof OPS_SETTINGS)[number]["name"];

export const settingNamed = (name: string): OpsSetting | undefined =>
  OPS_SETTINGS.find((setting) => setting.name === name);

/**
 * The most keys an open-keyed input may hold. Every input's value is read on
 * the hot path, so it has to stay small enough to be worth reading; thirty-two
 * bases is far past anything the catalogue will hold.
 */
export const MAX_OPEN_KEYS = 32;

/**
 * The largest the store's snapshot may grow, with every input at its widest:
 * the one row a request reads and parses (docs/decisions/0088-every-policy-in-the-console.md).
 * test/node/ops-settings.test.ts holds the register to it.
 */
export const MAX_SNAPSHOT_BYTES = 16 * 1024;
/** A base names itself; this is only long enough to hold FSM's own part names. */
const KEY = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

/** What one figure may be: its key's own bounds where it has them, else the input's, and what it counts. */
export function boundsOf(setting: NumberSetting, key?: string): Required<KeyBounds> {
  const own = key === undefined ? undefined : setting.bounds?.[key];
  return {
    min: own?.min ?? setting.min,
    max: own?.max ?? setting.max,
    unit: own?.unit ?? setting.unit,
  };
}

/** What is allowed, in the words a refusal shows: "50 to 1000 metres, a whole number". */
export function allowed(setting: NumberSetting, key?: string): string {
  const { min, max, unit } = boundsOf(setting, key);
  return `${String(min)} to ${String(max)} ${unit}, a whole number`;
}

/** Why a value was refused: the field it was in, and what that field will take. */
export interface Refusal {
  readonly field: string;
  readonly says: string;
}

const boundsRefusal = (setting: NumberSetting, field: string, value: unknown, key?: string): Refusal | null => {
  const { min, max } = boundsOf(setting, key);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { field, says: `${setting.title} must be ${allowed(setting, key)}.` };
  }
  if (value < min || value > max) {
    return { field, says: `${setting.title} must be ${allowed(setting, key)}. ${String(value)} is outside that.` };
  }
  return null;
};

const choiceRefusal = (setting: ChoiceSetting, key: string, value: unknown): Refusal | null => {
  const choices = setting.choices[key] ?? [];
  if (typeof value === "string" && choices.includes(value)) return null;
  return { field: `${setting.name}.${key}`, says: `${setting.title} takes one of ${choices.join(", ")} for ${key}.` };
};

export type Checked =
  { readonly ok: true; readonly value: SettingValue } | { readonly ok: false; readonly refusals: readonly Refusal[] };

const isKeyed = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A refusal unless the value names each of the closed set's keys, and nothing else. */
function keysRefusal(setting: OpsSetting, keys: readonly string[], given: readonly string[]): Refusal | null {
  const expected = [...keys].sort().join(", ");
  if (expected === [...given].sort().join(", ")) return null;
  return { field: setting.name, says: `${setting.title} needs one figure for each of ${expected}.` };
}

function checkChoices(setting: ChoiceSetting, value: unknown): Checked {
  if (!isKeyed(value)) {
    return { ok: false, refusals: [{ field: setting.name, says: `${setting.title} needs one choice per key.` }] };
  }
  const refusals = [
    keysRefusal(setting, setting.keys, Object.keys(value)),
    ...Object.entries(value).map(([key, each]) => choiceRefusal(setting, key, each)),
  ].filter((refusal): refusal is Refusal => refusal !== null);
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, value: value as Record<string, string> };
}

/**
 * A value ops sent, if the register allows it; otherwise every reason it does
 * not, each naming what that field will take. Nothing outside the bounds ever
 * reaches the store, so a reader never has to defend against one.
 */
export function checkValue(setting: OpsSetting, value: unknown): Checked {
  if (isChoice(setting)) return checkChoices(setting, value);
  if (setting.keys === null) {
    const refusal = boundsRefusal(setting, setting.name, value);
    return refusal === null ? { ok: true, value: value as number } : { ok: false, refusals: [refusal] };
  }

  if (!isKeyed(value)) {
    return { ok: false, refusals: [{ field: setting.name, says: `${setting.title} needs one figure per key.` }] };
  }
  const entries = Object.entries(value);
  const refusals: Refusal[] = [];

  if (setting.keys === "open") {
    if (!entries.some(([key]) => key === DEFAULT_KEY)) {
      refusals.push({
        field: `${setting.name}.${DEFAULT_KEY}`,
        says: `${setting.title} must always have a ${DEFAULT_KEY}.`,
      });
    }
    if (entries.length > MAX_OPEN_KEYS) {
      refusals.push({ field: setting.name, says: `${setting.title} takes at most ${String(MAX_OPEN_KEYS)} entries.` });
    }
    for (const [key] of entries) {
      if (key !== DEFAULT_KEY && !KEY.test(key)) {
        refusals.push({
          field: `${setting.name}.${key}`,
          says: "A name may hold letters, digits, spaces, dots, dashes and underscores.",
        });
      }
    }
  } else {
    const refusal = keysRefusal(setting, setting.keys, Object.keys(value));
    if (refusal !== null) refusals.push(refusal);
  }

  for (const [key, each] of entries) {
    const refusal = boundsRefusal(setting, `${setting.name}.${key}`, each, key);
    if (refusal !== null) refusals.push(refusal);
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, value: value as Record<string, number> };
}

/**
 * What a price may be set to, in paise before GST and as a GST rate. The
 * console shows these and the route refuses anything outside them; a price
 * lives in price_book, not in the table above, because an invoice already
 * issued depends on the figure that was in force then.
 *
 * 28 per cent is the highest GST slab there is, so a rate above it is a typing
 * slip and never a rate.
 */
export const PRICE_BOUNDS = { minPaise: 0, maxPaise: 100_000_000, minGstPercent: 0, maxGstPercent: 28 } as const;

/** A tier names itself: "standard", and whatever the bases are called when the catalogue has them. */
export const PRICE_TIER = /^[a-z][a-z0-9_]{0,31}$/;

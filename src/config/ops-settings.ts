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
import { UNLOCK_HOUR } from "../policy/job-visibility.ts";
import { NO_SHOW_WAIT_MIN } from "../policy/no-show.ts";
import { TASK_GROUPS, TASK_SLA_HOURS } from "../policy/tasks.ts";
import { DEFAULT_PIECE_CYCLE_DAYS, PIECE_CYCLE_DAYS } from "./pieces.ts";
import { VISIT_TYPES } from "./visit-types.ts";

/** One number, or one per key. */
export type SettingValue = number | Readonly<Record<string, number>>;

export interface OpsSetting {
  readonly name: string;
  /** What ops read above the field. */
  readonly title: string;
  /** Why it matters, in the words a non-developer needs to set it. */
  readonly note: string;
  /** What the number counts: metres, minutes, hours, days, or the hour of the day. */
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  /**
   * null for one number. A list of keys where the set is closed, as the visit
   * types and the task groups are. "open" where ops name the keys themselves:
   * a piece base is whatever FSM's part item is called, so the set cannot be
   * known here, and the key `default` then stands for every base without one.
   */
  readonly keys: readonly string[] | "open" | null;
  /** In force while the store holds no row, or cannot be read. */
  readonly fallback: SettingValue;
  /** The module the fallback lives in, so the number can be found in the code. */
  readonly source: string;
}

/** The key an open-keyed input must always carry: the figure every other key falls back to. */
export const DEFAULT_KEY = "default";

export const OPS_SETTINGS = [
  {
    name: "checkin_radius_m",
    title: "Check-in radius",
    note: "How close to the address a technician must be for I have arrived to pass. Every check-in records the distance it measured and the radius in force, whether it passed or not, so this can be tuned from real arrivals.",
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
    note: "How long a technician waits, from check-in, before he may close a job as a no-show. One figure per kind of visit.",
    unit: "minutes",
    min: 5,
    max: 120,
    keys: VISIT_TYPES,
    fallback: NO_SHOW_WAIT_MIN,
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
    note: "How long a piece on each base lasts before it is due for replacement. Name a base exactly as FSM's part item names it; every base without a figure of its own uses default.",
    unit: "days",
    min: 30,
    max: 1095,
    keys: "open",
    fallback: { ...PIECE_CYCLE_DAYS, [DEFAULT_KEY]: DEFAULT_PIECE_CYCLE_DAYS },
    source: "src/config/pieces.ts",
  },
] as const satisfies readonly OpsSetting[];

export type OpsSettingName = (typeof OPS_SETTINGS)[number]["name"];

export const settingNamed = (name: string): OpsSetting | undefined =>
  OPS_SETTINGS.find((setting) => setting.name === name);

/**
 * The most keys an open-keyed input may hold. The whole register is read on
 * the hot path, so it has to stay small enough to be worth reading; thirty-two
 * bases is far past anything the catalogue will hold.
 */
export const MAX_OPEN_KEYS = 32;
/** A base names itself; this is only long enough to hold FSM's own part names. */
const KEY = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;

/** What is allowed, in the words a refusal shows: "50 to 1000 metres, a whole number". */
export function allowed(setting: OpsSetting): string {
  return `${String(setting.min)} to ${String(setting.max)} ${setting.unit}, a whole number`;
}

/** Why a value was refused: the field it was in, and what that field will take. */
export interface Refusal {
  readonly field: string;
  readonly says: string;
}

const boundsRefusal = (setting: OpsSetting, field: string, value: unknown): Refusal | null => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { field, says: `${setting.title} must be ${allowed(setting)}.` };
  }
  if (value < setting.min || value > setting.max) {
    return { field, says: `${setting.title} must be ${allowed(setting)}. ${String(value)} is outside that.` };
  }
  return null;
};

export type Checked =
  { readonly ok: true; readonly value: SettingValue } | { readonly ok: false; readonly refusals: readonly Refusal[] };

/**
 * A value ops sent, if the register allows it; otherwise every reason it does
 * not, each naming what that field will take. Nothing outside the bounds ever
 * reaches the store, so a reader never has to defend against one.
 */
export function checkValue(setting: OpsSetting, value: unknown): Checked {
  if (setting.keys === null) {
    const refusal = boundsRefusal(setting, setting.name, value);
    return refusal === null ? { ok: true, value: value as number } : { ok: false, refusals: [refusal] };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, refusals: [{ field: setting.name, says: `${setting.title} needs one figure per key.` }] };
  }
  const entries = Object.entries(value as Record<string, unknown>);
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
    const expected = [...setting.keys].sort().join(", ");
    const given = entries
      .map(([key]) => key)
      .sort()
      .join(", ");
    if (expected !== given) {
      refusals.push({ field: setting.name, says: `${setting.title} needs one figure for each of ${expected}.` });
    }
  }

  for (const [key, each] of entries) {
    const refusal = boundsRefusal(setting, `${setting.name}.${key}`, each);
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

// The register of business inputs ops set for themselves
// (src/policy/ops-settings.ts, docs/decisions/0061-ops-editable-inputs.md).
//
// Two things are held here: that a figure outside the bounds never reaches the
// store and the refusal says what is allowed, and that what the hot path reads
// of the store stays small enough not to leave Cloudflare's free tier
// (docs/decisions/0088-every-policy-in-the-console.md).

import { describe, expect, it } from "vitest";
import {
  allowed,
  boundsOf,
  checkValue,
  DEFAULT_KEY,
  MAX_OPEN_KEYS,
  MAX_SNAPSHOT_BYTES,
  OPS_SETTINGS,
  isChoice,
  PRICE_BOUNDS,
  settingNamed,
  type NumberSetting,
  type OpsSetting,
  type SettingValue,
} from "../../../../src/policy/ops-settings.ts";
import { COMMITTED, SETTINGS_TTL_MS } from "../../../../src/domain/ops-settings.ts";
import { CHECKIN_RADIUS_M } from "../../../../src/policy/check-in.ts";
import { UNLOCK_HOUR } from "../../../../src/policy/job-visibility.ts";
import { NEXT_VISIT_DAY_BOUNDS, NEXT_VISIT_DAYS } from "../../../../src/policy/next-visit.ts";
import { NO_SHOW_WAIT_MIN } from "../../../../src/policy/no-show.ts";
import { TASK_SLA_HOURS } from "../../../../src/policy/tasks.ts";
import { DEFAULT_PIECE_CYCLE_DAYS } from "../../../../src/config/pieces.ts";
import { settings } from "../../../../apps/ops/src/content.ts";

const named = (name: string): OpsSetting => {
  const setting = settingNamed(name);
  if (setting === undefined) throw new Error(`${name} is not in the register`);
  return setting;
};

const numbered = (name: string): NumberSetting => {
  const setting = named(name);
  if (isChoice(setting)) throw new Error(`${name} is a rule of choices`);
  return setting;
};

const REGISTER: readonly OpsSetting[] = OPS_SETTINGS;
const NUMBERS = REGISTER.filter((setting): setting is NumberSetting => !isChoice(setting));
const CHOICES = REGISTER.filter(isChoice);

describe("the register", () => {
  it.each(REGISTER)("$name says what it is for", (setting) => {
    expect(setting.note).not.toBe("");
  });

  it.each(NUMBERS)("$name says its unit and its bounds", (setting) => {
    expect(setting.unit).not.toBe("");
    expect(setting.min).toBeLessThan(setting.max);
  });

  it.each(CHOICES)("$name offers each of its keys two choices or more, its default among them", (setting) => {
    expect(Object.keys(setting.choices).sort()).toEqual([...setting.keys].sort());
    for (const key of setting.keys) {
      const choices = setting.choices[key] ?? [];
      expect(choices.length, key).toBeGreaterThanOrEqual(2);
      expect(choices, key).toContain(setting.fallback[key]);
    }
  });

  it("falls back to the figures the code already committed", () => {
    expect(COMMITTED.checkinRadiusM).toBe(CHECKIN_RADIUS_M);
    expect(COMMITTED.noShowWaitMin).toEqual(NO_SHOW_WAIT_MIN);
    expect(COMMITTED.addressUnlockHour).toBe(UNLOCK_HOUR);
    expect(COMMITTED.taskSlaHours).toEqual(TASK_SLA_HOURS);
    expect(COMMITTED.pieceCycleDays[DEFAULT_KEY]).toBe(DEFAULT_PIECE_CYCLE_DAYS);
  });

  // Ops were shown "no show decision" and "PLACEHOLDER STANDARD".
  const fixedKeys = (setting: OpsSetting): readonly string[] =>
    setting.keys === null || setting.keys === "open" ? [] : setting.keys;

  it.each(REGISTER.filter((setting) => fixedKeys(setting).length > 0))(
    "$name's every box is named in the console's words, not its key",
    (setting) => {
      const names = settings.rules.keyNames[setting.name] ?? {};
      for (const key of fixedKeys(setting)) expect(names[key], key).toBeTruthy();
    },
  );

  it.each(CHOICES)("$name's every choice is named in the console's words", (setting) => {
    const names = settings.rules.choiceNames[setting.name] ?? {};
    for (const choice of Object.values(setting.choices).flat()) expect(names[choice], choice).toBeTruthy();
  });

  it("offers ops no made-up base: every base falls to the one figure until ops name one", () => {
    expect(named("piece_cycle_days").fallback).toEqual({ [DEFAULT_KEY]: DEFAULT_PIECE_CYCLE_DAYS });
  });

  // Review of #145, item 5: the note said the charge was not in force until plan piece C3 built it, which it now is
  // (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md), so it says what a charge costs, and no longer that it waits.
  it("says what charging a no-show costs, now that a charge takes it", () => {
    const note = named("no_show_charge").note;
    expect(note).toContain("costs when you charge a no-show");
    expect(note).not.toContain("does not take effect");
  });

  it.each(REGISTER)("$name's note is written for ops, not for whoever reads the code", (setting) => {
    expect(setting.note).not.toMatch(/\b(he|his|him)\b|src\/|PLACEHOLDER/);
  });

  it.each(NUMBERS)("$name's own default is inside its own bounds, each key's where it has them", (setting) => {
    const figures: [string | undefined, number][] =
      typeof setting.fallback === "number" ? [[undefined, setting.fallback]] : Object.entries(setting.fallback);
    for (const [key, figure] of figures) {
      const { min, max } = boundsOf(setting, key);
      expect(figure, key).toBeGreaterThanOrEqual(min);
      expect(figure, key).toBeLessThanOrEqual(max);
      // A key's own bounds are inside the widest the rule states.
      expect(min, key).toBeGreaterThanOrEqual(setting.min);
      expect(max, key).toBeLessThanOrEqual(setting.max);
    }
  });

  it("gives the next visit's days one input, with each key's bounds", () => {
    const days = numbered("booking_days");
    expect(days.keys).toEqual(Object.keys(NEXT_VISIT_DAYS));
    expect(days.bounds).toEqual(NEXT_VISIT_DAY_BOUNDS);
    expect(COMMITTED.nextVisitDays).toEqual(NEXT_VISIT_DAYS);
  });
});

describe("what a rule will take", () => {
  it("takes a whole number inside the bounds", () => {
    expect(checkValue(named("checkin_radius_m"), 150)).toEqual({ ok: true, value: 150 });
  });

  it.each([0, 49, 1001, 200.5, "200", null])("refuses %p, and says what is allowed", (value) => {
    const radius = numbered("checkin_radius_m");
    const checked = checkValue(radius, value);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.refusals[0]?.field).toBe("checkin_radius_m");
    expect(checked.refusals[0]?.says).toContain(allowed(radius));
  });

  it("names metres, minutes, hours and days, so a figure is never read as the wrong unit", () => {
    expect(allowed(numbered("checkin_radius_m"))).toBe("50 to 1000 metres, a whole number");
    expect(allowed(numbered("no_show_wait_min"))).toBe("5 to 120 minutes, a whole number");
    expect(allowed(numbered("task_sla_hours"))).toBe("1 to 720 hours, a whole number");
    expect(allowed(numbered("piece_cycle_days"))).toBe("30 to 1095 days, a whole number");
  });

  it("wants one figure for each of a closed set's keys, and refuses a set that is short or long", () => {
    const wait = named("no_show_wait_min");
    expect(checkValue(wait, { consultation: 20, service: 20, replacement: 20, first_fit: 20 }).ok).toBe(true);
    expect(checkValue(wait, { consultation: 20, service: 20 }).ok).toBe(false);
    expect(checkValue(wait, { ...NO_SHOW_WAIT_MIN, made_up: 20 }).ok).toBe(false);
  });

  it("names the field the figure was in, so a form can point at the box", () => {
    const checked = checkValue(named("task_sla_hours"), { ...TASK_SLA_HOURS, referral_review: 0 });
    expect(checked.ok).toBe(false);
    if (!checked.ok)
      expect(checked.refusals.map((refusal) => refusal.field)).toEqual(["task_sla_hours.referral_review"]);
  });

  it("lets ops name a base of their own, but never without a default to fall back on", () => {
    const cycles = named("piece_cycle_days");
    expect(checkValue(cycles, { [DEFAULT_KEY]: 180, "Lace base": 120 }).ok).toBe(true);
    expect(checkValue(cycles, { "Lace base": 120 }).ok).toBe(false);
  });

  it("caps how many bases the register holds, since the whole of it is read on the hot path", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_OPEN_KEYS + 1 }, (_, n) => [`base${String(n)}`, 180]));
    expect(checkValue(named("piece_cycle_days"), { ...many, [DEFAULT_KEY]: 180 }).ok).toBe(false);
  });

  it("refuses an array, which JSON would otherwise take for an object", () => {
    expect(checkValue(named("no_show_wait_min"), [15, 15, 15, 15]).ok).toBe(false);
  });

  it("holds each key of the next visit's days to its own bounds, and says them in the refusal", () => {
    const days = numbered("booking_days");
    expect(checkValue(days, { ...NEXT_VISIT_DAYS, first_fit_lead: 0 }).ok).toBe(true);
    // Nought is the lead time's floor, and ten days the cadence's ceiling is far above, but neither is the horizon's.
    for (const horizon of [0, 10, 91]) {
      const checked = checkValue(days, { ...NEXT_VISIT_DAYS, horizon });
      expect(checked.ok, String(horizon)).toBe(false);
      if (checked.ok) continue;
      expect(checked.refusals).toEqual([
        { field: "booking_days.horizon", says: expect.stringContaining("14 to 90 days, a whole number") as string },
      ]);
    }
    expect(allowed(days, "first_fit_lead")).toBe("0 to 30 days, a whole number");
    expect(allowed(days, "service_cadence")).toBe("14 to 90 days, a whole number");
    expect(allowed(days)).toBe("0 to 90 days, a whole number");
  });
});

describe("a price", () => {
  it("runs to ten lakh, and no further, and stops well short of a rate no GST slab reaches", () => {
    expect(PRICE_BOUNDS.maxPaise).toBe(100_000_000);
    expect(PRICE_BOUNDS.maxGstPercent).toBe(28);
  });
});

/** The widest figure a setting will take, as JSON would hold it: every key it may have, each at its longest. */
function widest(setting: OpsSetting): SettingValue {
  if (isChoice(setting)) {
    const longest = (choices: readonly string[]) => choices.reduce((a, b) => (b.length > a.length ? b : a), "");
    return Object.fromEntries(setting.keys.map((key) => [key, longest(setting.choices[key] ?? [])]));
  }
  const longestKey = "k".repeat(64);
  if (setting.keys === null) return setting.max;
  const keys =
    setting.keys === "open"
      ? [DEFAULT_KEY, ...Array.from({ length: MAX_OPEN_KEYS - 1 }, (_, n) => `${longestKey.slice(3)}${String(n)}`)]
      : setting.keys;
  return Object.fromEntries(keys.map((key) => [key, boundsOf(setting, key).max]));
}

describe("the cost of reading them", () => {
  // What the register's length now costs is the snapshot's size, which every read parses.
  it("keeps the snapshot small enough to parse on a request, whatever ops set", () => {
    const largest = JSON.stringify(Object.fromEntries(OPS_SETTINGS.map((setting) => [setting.name, widest(setting)])));
    expect(largest.length).toBeLessThanOrEqual(MAX_SNAPSHOT_BYTES);
  });

  it("is stale for a minute at most, which is what the console promises", () => {
    expect(SETTINGS_TTL_MS).toBe(60_000);
  });
});

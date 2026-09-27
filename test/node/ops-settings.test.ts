// The register of business inputs ops set for themselves
// (src/config/ops-settings.ts, docs/decisions/0061-ops-editable-inputs.md).
//
// Two things are held here: that a figure outside the bounds never reaches the
// store and the refusal says what is allowed, and that the whole register stays
// small enough to read on the hot path without leaving Cloudflare's free tier.

import { describe, expect, it } from "vitest";
import {
  allowed,
  boundsOf,
  checkValue,
  DEFAULT_KEY,
  MAX_OPEN_KEYS,
  OPS_SETTINGS,
  PRICE_BOUNDS,
  settingNamed,
  type OpsSetting,
} from "../../src/config/ops-settings.ts";
import { COMMITTED, SETTINGS_TTL_MS } from "../../src/domain/ops-settings.ts";
import { CHECKIN_RADIUS_M } from "../../src/policy/check-in.ts";
import { UNLOCK_HOUR } from "../../src/policy/job-visibility.ts";
import { NEXT_VISIT_DAY_BOUNDS, NEXT_VISIT_DAYS } from "../../src/policy/next-visit.ts";
import { NO_SHOW_WAIT_MIN } from "../../src/policy/no-show.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { DEFAULT_PIECE_CYCLE_DAYS } from "../../src/config/pieces.ts";
import { FREE_TIER } from "../../scripts/lib/free-tier-budget.ts";
import { settings } from "../../apps/ops/src/content.ts";

const named = (name: string): OpsSetting => {
  const setting = settingNamed(name);
  if (setting === undefined) throw new Error(`${name} is not in the register`);
  return setting;
};

describe("the register", () => {
  it.each(OPS_SETTINGS)("$name says its unit, its bounds and where its default lives", (setting) => {
    expect(setting.unit).not.toBe("");
    expect(setting.note).not.toBe("");
    expect(setting.min).toBeLessThan(setting.max);
    expect(setting.source).toMatch(/^src\/(config|policy)\/[a-z-]+\.ts$/);
  });

  it("falls back to the figures the code already committed", () => {
    expect(COMMITTED.checkinRadiusM).toBe(CHECKIN_RADIUS_M);
    expect(COMMITTED.noShowWaitMin).toEqual(NO_SHOW_WAIT_MIN);
    expect(COMMITTED.addressUnlockHour).toBe(UNLOCK_HOUR);
    expect(COMMITTED.taskSlaHours).toEqual(TASK_SLA_HOURS);
    expect(COMMITTED.pieceCycleDays[DEFAULT_KEY]).toBe(DEFAULT_PIECE_CYCLE_DAYS);
  });

  // OPS-19 of the audit, 24 September 2026: ops were shown "no show decision" and "PLACEHOLDER STANDARD".
  const fixedKeys = (setting: OpsSetting): readonly string[] =>
    setting.keys === null || setting.keys === "open" ? [] : setting.keys;

  it.each(OPS_SETTINGS.filter((setting) => fixedKeys(setting).length > 0))(
    "$name's every box is named in the console's words, not its key",
    (setting) => {
      const names = settings.rules.keyNames[setting.name] ?? {};
      for (const key of fixedKeys(setting)) expect(names[key], key).toBeTruthy();
    },
  );

  it("offers ops no made-up base: every base falls to the one figure until ops name one", () => {
    expect(named("piece_cycle_days").fallback).toEqual({ [DEFAULT_KEY]: DEFAULT_PIECE_CYCLE_DAYS });
  });

  it.each(OPS_SETTINGS)("$name's note is written for ops, not for whoever reads the code", (setting) => {
    expect(setting.note).not.toMatch(/\b(he|his|him)\b|src\/|PLACEHOLDER/);
  });

  it.each(OPS_SETTINGS)("$name's own default is inside its own bounds, each key's where it has them", (setting) => {
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

  it("gives the next visit's days one input, with each key's bounds, not seven of the ten the register holds", () => {
    const days = named("booking_days");
    expect(days.keys).toEqual(Object.keys(NEXT_VISIT_DAYS));
    expect(days.bounds).toEqual(NEXT_VISIT_DAY_BOUNDS);
    expect(COMMITTED.nextVisitDays).toEqual(NEXT_VISIT_DAYS);
    expect(days.source).toBe("src/policy/next-visit.ts");
  });
});

describe("what a rule will take", () => {
  it("takes a whole number inside the bounds", () => {
    expect(checkValue(named("checkin_radius_m"), 150)).toEqual({ ok: true, value: 150 });
  });

  it.each([0, 49, 1001, 200.5, "200", null])("refuses %p, and says what is allowed", (value) => {
    const radius = named("checkin_radius_m");
    const checked = checkValue(radius, value);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.refusals[0]?.field).toBe("checkin_radius_m");
    expect(checked.refusals[0]?.says).toContain(allowed(radius));
  });

  it("names metres, minutes, hours and days, so a figure is never read as the wrong unit", () => {
    expect(allowed(named("checkin_radius_m"))).toBe("50 to 1000 metres, a whole number");
    expect(allowed(named("no_show_wait_min"))).toBe("5 to 120 minutes, a whole number");
    expect(allowed(named("task_sla_hours"))).toBe("1 to 720 hours, a whole number");
    expect(allowed(named("piece_cycle_days"))).toBe("30 to 1095 days, a whole number");
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
    const days = named("booking_days");
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

describe("the cost of reading them", () => {
  /**
   * The hot read is one row per name in the register, and an isolate holds it
   * for SETTINGS_TTL_MS. The bound is not a guess at how many isolates run: the
   * free plan stops the day at 100,000 requests, and a request reads the
   * register at most once, so the ceiling is that times the register's length
   * however the cache behaves. ADR 0061 claims a fifth of D1's day for it,
   * which leaves room for ten inputs; the eleventh fails here rather than on a
   * Friday.
   */
  it("stays inside the fifth of D1's day ADR 0061 claims, even if no request ever hit the cache", () => {
    const worstCaseRows = FREE_TIER.workersRequestsPerDay * OPS_SETTINGS.length;
    expect(worstCaseRows).toBeLessThanOrEqual(FREE_TIER.d1RowsReadPerDay / 5);
  });

  it("is stale for a minute at most, which is what the console promises", () => {
    expect(SETTINGS_TTL_MS).toBe(60_000);
  });
});

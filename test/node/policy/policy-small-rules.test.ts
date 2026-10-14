// The small policy modules each a route or a job reads one figure or one rule from: a launch's day, a piece step as
// recorded, the first day a new price may start, how far back retention reaches, a supplier's codes, a target's
// ceiling, the limits on each counted use, and the stock settings' bounds and the referral holds' reasons.

import { describe, expect, it } from "vitest";
import type { Settings } from "../../../src/config/settings.ts";
import { CLIENT_NOTE_MAX_CHARS } from "../../../src/policy/client-notes.ts";
import { FRAUD_SIGNALS, HOLD_REASONS, REFERRAL_MONTHLY_CAP } from "../../../src/policy/fraud-holds.ts";
import { GRIEVANCE_MAX_CHARS, GRIEVANCES_PER_DAY, GRIEVANCES_SHOWN } from "../../../src/policy/grievances.ts";
import { isLaunchInFuture, launchDateAfter } from "../../../src/policy/launch.ts";
import { STOCK_SETTINGS } from "../../../src/policy/ops-settings-stock.ts";
import { pieceRecorded } from "../../../src/policy/piece-step.ts";
import { firstPriceDay } from "../../../src/policy/prices.ts";
import { limitOf, RATE_LIMITS, type RateLimitScope } from "../../../src/policy/rate-limits.ts";
import {
  AUDIT_LOG_MONTHS,
  monthsBefore,
  PURGED_PER_RUN,
  RESOLVED_ALERT_MONTHS,
  SENT_MESSAGE_MONTHS,
} from "../../../src/policy/retention.ts";
import { COUNTRY, CURRENCY, GSTIN } from "../../../src/policy/suppliers.ts";
import { mostFor, TARGET_MEASURE_NAMES } from "../../../src/policy/targets.ts";

describe("a city's launch", () => {
  it("is still to come only on a later day", () => {
    expect(isLaunchInFuture("2026-10-20", "2026-10-14")).toBe(true);
    expect(isLaunchInFuture("2026-10-14", "2026-10-14")).toBe(false);
  });

  it("is the pincode's own day where it is served and has one, else the launch day", () => {
    expect(launchDateAfter({ served: true, launchOn: "2026-11-01" }, "2026-12-01")).toBe("2026-11-01");
    expect(launchDateAfter({ served: false, launchOn: "2026-11-01" }, "2026-12-01")).toBe("2026-12-01");
    expect(launchDateAfter({ served: true, launchOn: null }, "2026-12-01")).toBe("2026-12-01");
  });
});

describe("a piece step", () => {
  const LABEL = "MM-STA-0000123-J";

  it("is recorded with what the phone left out as none", () => {
    expect(pieceRecorded({ piece_code: LABEL })).toEqual({
      piece_code: LABEL,
      base: null,
      supplier_lot: null,
      stock_code: null,
      failure_reason: null,
      old_piece: null,
    });
  });

  it("is refused for a label not in the label's shape, the piece fitted's or the old one's", () => {
    expect(pieceRecorded({ piece_code: "MM-STA-12" })).toEqual({ invalid: ["piece_code"] });
    expect(pieceRecorded({ piece_code: LABEL, old_piece: { piece_code: "MM-1", failure_reason: "lifted" } })).toEqual({
      invalid: ["old_piece"],
    });
  });
});

describe("a new price", () => {
  it("starts tomorrow at the soonest, across a month's end", () => {
    expect(firstPriceDay("2026-09-30")).toBe("2026-10-01");
  });
});

describe("retention", () => {
  it("reaches back whole months from now", () => {
    expect(monthsBefore(new Date("2026-10-14T06:30:00.000Z"), 12)).toBe("2025-10-14T06:30:00.000Z");
    expect(monthsBefore(new Date("2026-10-14T06:30:00.000Z"), 24)).toBe("2024-10-14T06:30:00.000Z");
  });

  it("keeps the audit log and sent messages longer than resolved alerts, a bounded number at a time", () => {
    expect(AUDIT_LOG_MONTHS).toBeGreaterThanOrEqual(SENT_MESSAGE_MONTHS);
    expect(SENT_MESSAGE_MONTHS).toBeGreaterThanOrEqual(RESOLVED_ALERT_MONTHS);
    expect(PURGED_PER_RUN).toBeGreaterThan(0);
  });
});

describe("a supplier's codes", () => {
  it("take a GSTIN, a country and a currency in their own shapes", () => {
    expect(GSTIN.test("27AAPFU0939F1ZV")).toBe(true);
    expect(GSTIN.test("27aapfu0939f1zv")).toBe(false);
    expect(GSTIN.test("27AAPFU0939F1Z")).toBe(false);
    expect([COUNTRY.test("IN"), COUNTRY.test("IND"), CURRENCY.test("INR"), CURRENCY.test("IN")]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
});

describe("a target", () => {
  it("goes up to 100 for a percentage, and far higher for a count or rupees", () => {
    expect(mostFor("utilisation")).toBe(100);
    expect(mostFor("on_time")).toBe(100);
    expect(mostFor("revenue")).toBe(10_000_000);
    expect(TARGET_MEASURE_NAMES).toContain("leads");
  });
});

describe("the limits on each counted use", () => {
  // Every figure a limit reads from the settings, so each resolves to its own.
  const settings = {
    leadIpDailyLimit: 11,
    leadMobileDailyLimit: 12,
    login: { codeIpHourlyLimit: 13, codeMobileDailyLimit: 14, codeDailyCeiling: 15, techCodeDailyCeiling: 16 },
    tryon: {
      uploadIpHourlyLimit: 17,
      generateIpHourlyLimit: 18,
      claimMobileDailyLimit: 19,
      resultMessageMobileDailyLimit: 20,
      uploadDailyCeiling: 21,
      renderDailyCeiling: 22,
      resultReadDailyCeiling: 23,
    },
    geocode: { dailyCeiling: 24 },
  } as unknown as Settings;

  it("are each a whole number above nought, over an hour or a day", () => {
    for (const [scope, rule] of Object.entries(RATE_LIMITS)) {
      const limit = limitOf(scope as RateLimitScope, settings);
      expect(Number.isInteger(limit) && limit > 0, scope).toBe(true);
      expect(["hour", "day"], scope).toContain(rule.per);
    }
  });

  it("read the settings where they are set there, and keep their own figure where not", () => {
    expect(limitOf("booking:ip", settings)).toBe(11);
    expect(limitOf("ceiling:geocode", settings)).toBe(24);
    expect(limitOf("grievance:person", settings)).toBe(GRIEVANCES_PER_DAY);
  });
});

describe("the stock settings", () => {
  it("each hold their committed figures within their own bounds", () => {
    for (const setting of STOCK_SETTINGS) {
      const fallback = setting.fallback as unknown as Readonly<Record<string, number>> | number;
      const values = typeof fallback === "number" ? { value: fallback } : fallback;
      for (const [key, value] of Object.entries(values)) {
        const bounds =
          "bounds" in setting
            ? (setting.bounds as Readonly<Record<string, { min: number; max: number }>>)[key]
            : undefined;
        const { min, max } = bounds ?? setting;
        expect(value >= min && value <= max, `${setting.name}.${key} = ${String(value)}`).toBe(true);
      }
    }
  });
});

describe("the small figures", () => {
  it("are what the routes and the console hold to", () => {
    expect(HOLD_REASONS).toEqual([...FRAUD_SIGNALS, "attached_after_fit"]);
    expect(REFERRAL_MONTHLY_CAP).toBeGreaterThan(0);
    expect(GRIEVANCES_SHOWN).toBeLessThanOrEqual(GRIEVANCES_PER_DAY);
    expect(GRIEVANCE_MAX_CHARS).toBeGreaterThan(CLIENT_NOTE_MAX_CHARS);
  });
});

// Rules held against one another (src/policy/setting-relations.ts; docs/decisions/0319-rules-that-hold-together.md):
// each side refused where it would break the other, and every committed default holding with the rest.

import { describe, expect, it } from "vitest";
import { OPS_SETTINGS } from "../../../src/policy/ops-settings.ts";
import { cityConflict, HELD_TOGETHER, nationalConflict, type Standing } from "../../../src/policy/setting-relations.ts";

/** The committed defaults, as the register holds them. */
const fallbackOf = (name: string): unknown => OPS_SETTINGS.find((setting) => setting.name === name)?.fallback;
const figure = (name: string) => fallbackOf(name) as number;
const figures = (name: string) => fallbackOf(name) as Readonly<Record<string, number>>;

const DEFAULTS: Standing = {
  checkinRadius: figure("checkin_radius_m"),
  roughRadius: figure("checkin_radius_approximate_m"),
  unlockHour: figure("address_unlock_hour"),
  reminderHour: figure("reminder_hour"),
  workingHours: { opens: figures("working_hours").opens ?? 0, closes: figures("working_hours").closes ?? 24 },
  breakHours: { from: figures("booking_rules").break_from ?? 24, to: figures("booking_rules").break_to ?? 0 },
  taskDeadlines: figures("task_sla_hours"),
  lapseDays: figure("task_lapse_days"),
  cityRadii: [],
  cityReminderHours: [],
};

describe("rules held together", () => {
  it("holds every committed default against the rest", () => {
    for (const name of HELD_TOGETHER) expect(nationalConflict(name, fallbackOf(name), DEFAULTS), name).toBeNull();
  });

  it("keeps the check-in radius, the nation's or a city's, within the radius at a rough pin", () => {
    const standing = { ...DEFAULTS, checkinRadius: 200, roughRadius: 500, cityRadii: [400] };
    expect(nationalConflict("checkin_radius_m", 500, standing)).toBeNull();
    expect(nationalConflict("checkin_radius_m", 501, standing)).toEqual([
      "checkin_radius_m",
      "checkin_radius_approximate_m",
    ]);
    // A rough pin's radius may not fall below a city's own check-in radius either.
    expect(nationalConflict("checkin_radius_approximate_m", 400, standing)).toBeNull();
    expect(nationalConflict("checkin_radius_approximate_m", 399, standing)).toEqual([
      "checkin_radius_approximate_m",
      "checkin_radius_m",
    ]);
    expect(cityConflict("checkin_radius_m", 501, standing)).toEqual([
      "checkin_radius_m",
      "checkin_radius_approximate_m",
    ]);
    expect(cityConflict("checkin_radius_m", 500, standing)).toBeNull();
  });

  it("unlocks the address no earlier than reminders go, the nation's or a city's", () => {
    const standing = { ...DEFAULTS, unlockHour: 19, reminderHour: 18, cityReminderHours: [19] };
    expect(nationalConflict("address_unlock_hour", 19, standing)).toBeNull();
    expect(nationalConflict("address_unlock_hour", 18, standing)).toEqual(["address_unlock_hour", "reminder_hour"]);
    expect(nationalConflict("reminder_hour", 19, standing)).toBeNull();
    expect(nationalConflict("reminder_hour", 20, standing)).toEqual(["reminder_hour", "address_unlock_hour"]);
    expect(cityConflict("reminder_hour", 20, standing)).toEqual(["reminder_hour", "address_unlock_hour"]);
    expect(cityConflict("reminder_hour", 19, standing)).toBeNull();
  });

  it("keeps the booking break within the working day, from either side", () => {
    const standing = { ...DEFAULTS, workingHours: { opens: 10, closes: 14 }, breakHours: { from: 12, to: 13 } };
    const rules = figures("booking_rules");
    expect(nationalConflict("booking_rules", { ...rules, break_from: 12, break_to: 14 }, standing)).toBeNull();
    expect(nationalConflict("booking_rules", { ...rules, break_from: 12, break_to: 15 }, standing)).toEqual([
      "booking_rules.break_to",
      "working_hours.closes",
    ]);
    expect(nationalConflict("working_hours", { opens: 12, closes: 13 }, standing)).toBeNull();
    expect(nationalConflict("working_hours", { opens: 13, closes: 20 }, standing)).toEqual([
      "working_hours.opens",
      "booking_rules.break_from",
    ]);
    expect(nationalConflict("working_hours", { opens: 9, closes: 12 }, standing)).toEqual([
      "working_hours.closes",
      "booking_rules.break_to",
    ]);
  });

  it("lapses no task before its longest deadline", () => {
    const standing = { ...DEFAULTS, taskDeadlines: { care: 24, grievance: 720 }, lapseDays: 30 };
    expect(nationalConflict("task_lapse_days", 30, standing)).toBeNull();
    expect(nationalConflict("task_lapse_days", 29, standing)).toEqual(["task_lapse_days", "task_sla_hours.grievance"]);
    expect(nationalConflict("task_sla_hours", { care: 24, grievance: 721 }, standing)).toEqual([
      "task_sla_hours.grievance",
      "task_lapse_days",
    ]);
    expect(nationalConflict("task_sla_hours", { care: 24, grievance: 720 }, standing)).toBeNull();
  });

  it("holds nothing against a rule no other is held to", () => {
    expect(HELD_TOGETHER.has("no_show_wait_min")).toBe(false);
    expect(nationalConflict("no_show_wait_min", 10, DEFAULTS)).toBeNull();
  });
});

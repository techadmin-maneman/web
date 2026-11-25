// What each rule another is held to stands at now, read when one of them is saved (src/policy/setting-relations.ts):
// the national rules as Settings holds them, defaults where none is set, and the cities' own figures for theirs.

import { cityRules } from "../domain/cities/city-rules.ts";
import { settingStates } from "../domain/platform/ops-settings.ts";
import { leadsPastHorizon } from "../domain/purchasing/lead-horizon.ts";
import { checkValue, settingNamed } from "../policy/ops-settings.ts";
import { cityConflict, type Conflict, type Standing } from "../policy/setting-relations.ts";

export async function settingStanding(db: D1Database): Promise<Standing> {
  const [states, cities] = await Promise.all([settingStates(db), cityRules(db)]);
  const valueOf = (name: string): unknown => states.find((state) => state.setting.name === name)?.value;
  const figure = (name: string): number => {
    const value = valueOf(name);
    if (typeof value !== "number") throw new Error(`the register holds no figure for ${name}`);
    return value;
  };
  const figures = (name: string): Readonly<Record<string, number>> => {
    const value = valueOf(name);
    if (typeof value !== "object" || value === null) throw new Error(`the register holds no figures for ${name}`);
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, each]) => (typeof each === "number" ? [[key, each] as const] : [])),
    );
  };
  const day = figures("working_hours");
  const booking = figures("booking_rules");
  const own = [...cities.values()];
  return {
    checkinRadius: figure("checkin_radius_m"),
    roughRadius: figure("checkin_radius_approximate_m"),
    unlockHour: figure("address_unlock_hour"),
    reminderHour: figure("reminder_hour"),
    workingHours: { opens: day.opens ?? 0, closes: day.closes ?? 24 },
    breakHours: { from: booking.break_from ?? 24, to: booking.break_to ?? 0 },
    taskDeadlines: figures("task_sla_hours"),
    lapseDays: figure("task_lapse_days"),
    cityRadii: own.flatMap((rules) => (typeof rules.checkin_radius_m === "number" ? [rules.checkin_radius_m] : [])),
    cityReminderHours: own.flatMap((rules) => (typeof rules.reminder_hour === "number" ? [rules.reminder_hour] : [])),
  };
}

/** A city's own figure for a rule, within its bounds, against the national rule it is held to; null where it holds. */
export async function cityRuleConflict(db: D1Database, name: string, value: unknown): Promise<Conflict | null> {
  const setting = settingNamed(name);
  if (value === null || setting === undefined) return null;
  const checked = checkValue(setting, value);
  return checked.ok ? cityConflict(name, checked.value, await settingStanding(db)) : null;
}

/**
 * A new planning period or horizon against the suppliers' lead times: refused where the forecast would no longer reach
 * past one of them and a period; null where it still does.
 */
export async function leadTimeConflict(db: D1Database, name: string, value: unknown): Promise<Conflict | null> {
  if ((name !== "planning_horizon_periods" && name !== "planning_period_days") || typeof value !== "number")
    return null;
  const states = await settingStates(db);
  const now = (rule: string): number => {
    const held = states.find((state) => state.setting.name === rule)?.value;
    if (typeof held !== "number") throw new Error(`the register holds no figure for ${rule}`);
    return held;
  };
  const planning =
    name === "planning_horizon_periods"
      ? { periodDays: now("planning_period_days"), horizonPeriods: value }
      : { periodDays: value, horizonPeriods: now("planning_horizon_periods") };
  return (await leadsPastHorizon(db, planning)).length > 0 ? [name, "supplier_items.lead_time_days"] : null;
}

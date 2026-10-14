// The rules a city sets apart from the national ones (docs/decisions/0198-cities-as-data.md): the check-in radius and
// the reminder hour. A city that sets none follows the national rule, and what one sets is checked as the national
// rule is, so a reader never meets a figure outside its bounds.

import { hourHasCome, isCitySetting, type CitySettingName } from "../../policy/city-settings.ts";
import { checkValue, conflictOf, settingNamed, type SettingValue } from "../../policy/ops-settings.ts";
import { auditStatement, type AuditEntry } from "../platform/audit.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";

/** What a city sets of each rule it sets. */
export type CityRules = Readonly<Partial<Record<CitySettingName, SettingValue>>>;

const parsed = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

/** A stored figure, if its rule still takes it; null for one the register would refuse now. */
function accepted(name: string, value: unknown): { name: CitySettingName; value: SettingValue } | null {
  const setting = settingNamed(name);
  if (setting === undefined || !isCitySetting(name)) return null;
  const checked = checkValue(setting, value);
  if (!checked.ok || conflictOf(setting, checked.value) !== null) return null;
  return { name, value: checked.value };
}

/** Each city's own rules, by city: every city that sets one. */
export async function cityRules(db: D1Database): Promise<ReadonlyMap<string, CityRules>> {
  const { results } = await db
    .prepare("SELECT city, key, value FROM city_settings ORDER BY city, key")
    .all<{ city: string; key: string; value: string }>();
  const rules = new Map<string, Partial<Record<CitySettingName, SettingValue>>>();
  for (const row of results) {
    const kept = accepted(row.key, parsed(row.value));
    if (kept === null) continue;
    rules.set(row.city, { ...rules.get(row.city), [kept.name]: kept.value });
  }
  return rules;
}

/** The rules the city of a visit sets for itself, read with the visit in one look; none for a city that sets none. */
export async function rulesOfVisit(db: D1Database, visitId: string): Promise<CityRules> {
  const { results } = await db
    .prepare(
      `SELECT s.key, s.value FROM appointments a JOIN city_settings s ON s.city = a.service_city WHERE a.id = ?1`,
    )
    .bind(visitId)
    .all<{ key: string; value: string }>();
  const rules: Partial<Record<CitySettingName, SettingValue>> = {};
  for (const row of results) {
    const kept = accepted(row.key, parsed(row.value));
    if (kept !== null) rules[kept.name] = kept.value;
  }
  return rules;
}

/** The rules a statement read as JSON, json_group_object(key, json(value)): those the register still takes. */
export function rulesFrom(json: string | null): CityRules {
  const read = json === null ? null : parsed(json);
  if (typeof read !== "object" || read === null) return {};
  const rules: Partial<Record<CitySettingName, SettingValue>> = {};
  for (const [name, value] of Object.entries(read)) {
    const kept = accepted(name, value);
    if (kept !== null) rules[kept.name] = kept.value;
  }
  return rules;
}

/** The inputs that hold in a city: the national ones, with what the city sets for itself in their place. */
export function inputsIn(inputs: OpsInputs, rules: CityRules): OpsInputs {
  const radius = rules.checkin_radius_m;
  const hour = rules.reminder_hour;
  return {
    ...inputs,
    ...(typeof radius === "number" ? { checkinRadiusM: radius } : {}),
    ...(typeof hour === "number" ? { reminderHour: hour } : {}),
  };
}

/** The reminder hour of each city that sets its own; every other city keeps the national one. */
export type CityHours = ReadonlyMap<string, number>;

/** The national reminder hour, alone or beside the hours of the cities that set their own. */
export type ReminderHours = number | { readonly national: number; readonly cities: CityHours };

export async function cityReminderHours(db: D1Database): Promise<CityHours> {
  const hours = new Map<string, number>();
  for (const [city, rules] of await cityRules(db)) {
    if (typeof rules.reminder_hour === "number") hours.set(city, rules.reminder_hour);
  }
  return hours;
}

/**
 * Where reminders may go out now, as SQL over a visit's city column: a city whose own hour has come, or any other city
 * once the national hour has. Its three values are bound from placeholder `first` on; null where no city's hour has
 * come yet, so nothing need be read at all.
 */
export function reminderHourCame(
  column: string,
  first: number,
  hours: ReminderHours,
  now: Date,
): { readonly sql: string; readonly values: readonly [string, number, string] } | null {
  const { national: hour, cities } =
    typeof hours === "number" ? { national: hours, cities: new Map<string, number>() } : hours;
  const due = [...cities].filter(([, own]) => hourHasCome(own, now)).map(([city]) => city);
  const national = hourHasCome(hour, now);
  if (!national && due.length === 0) return null;
  const [a, b, c] = [first, first + 1, first + 2].map((each) => `?${String(each)}`);
  return {
    sql: `(${column} IN (SELECT value FROM json_each(${a ?? ""}))
      OR (${b ?? ""} = 1 AND (${column} IS NULL OR ${column} NOT IN (SELECT value FROM json_each(${c ?? ""})))))`,
    values: [JSON.stringify(due), national ? 1 : 0, JSON.stringify([...cities.keys()])],
  };
}

/** Why a city's rule cannot be set: the rule is national only, or the figure is outside its bounds. */
export type RuleRefusal = { readonly kind: "national_only" } | { readonly kind: "refused"; readonly fields: string[] };

/**
 * A city's own figure for a rule, or, with a null value, the national rule back in the city, with its audit entry in
 * the same batch.
 */
export async function setCityRule(
  db: D1Database,
  rule: { readonly city: string; readonly name: string; readonly value: unknown },
  audit: Omit<AuditEntry, "action" | "subject">,
  now: Date,
): Promise<RuleRefusal | null> {
  const setting = settingNamed(rule.name);
  if (setting === undefined || !isCitySetting(rule.name)) return { kind: "national_only" };
  const subject = { kind: "city", id: rule.city };
  if (rule.value === null) {
    await db.batch([
      db.prepare("DELETE FROM city_settings WHERE city = ?1 AND key = ?2").bind(rule.city, rule.name),
      auditStatement(db, { ...audit, action: "city_rule.clear", subject, detail: { rule: rule.name } }, now),
    ]);
    return null;
  }
  const checked = checkValue(setting, rule.value);
  if (!checked.ok) return { kind: "refused", fields: checked.refusals.map((each) => each.field) };
  const conflict = conflictOf(setting, checked.value);
  if (conflict !== null) return { kind: "refused", fields: [...conflict] };
  await db.batch([
    db
      .prepare(
        "INSERT OR REPLACE INTO city_settings (city, key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .bind(rule.city, rule.name, JSON.stringify(checked.value), audit.actor.id, now.toISOString()),
    auditStatement(db, { ...audit, action: "city_rule.set", subject, detail: { rule: rule.name } }, now),
  ]);
  return null;
}

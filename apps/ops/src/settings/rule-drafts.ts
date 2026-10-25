// A rule as ops read and type it in Settings' policies (./Rules.tsx): each box's name, the bounds a figure is held to,
// a choice's words, and a refusal in the console's words. A box holds text, never a number, since an empty box read
// as nought would be a radius no arrival passes.

import { errorText } from "@maneman/web-kit/refusal";
import { DAY_OF_WEEK, HOUR_OF_DAY } from "@rules/config/setting-units.ts";
import type { ChoiceRule, NumberRule, OpsSetting } from "../api.ts";
import { settings } from "../content/settings.ts";

const copy = settings.rules;

export function keyLabel(rule: OpsSetting, key: string): string {
  if (key === "default") return copy.defaultKey;
  return copy.keyNames[rule.name]?.[key] ?? key;
}

/** The box a refusal names: "no_show_wait_min.first_fit" is First fit, and the rule's own name the rule. */
function fieldLabel(rule: OpsSetting, field: string): string {
  const [, key] = field.split(".");
  return key === undefined ? rule.title : keyLabel(rule, key);
}

export function ruleRefusal(rule: OpsSetting, code: string, fields: readonly string[]): string | undefined {
  const [field, reached] = fields;
  if (code === "figures_conflict" && field !== undefined && reached !== undefined) {
    return copy.figures_conflict(fieldLabel(rule, field), fieldLabel(rule, reached));
  }
  if (code !== "invalid_request") return errorText(copy.errors, { code });
  if (field === undefined) return copy.errors.invalid_request;
  // A figure refused is given its range: "Check-in radius: Enter 50–500 metres."
  const range = "min" in rule ? rangeWords(boundsOf(rule, field.split(".")[1] ?? rule.name)) : copy.chooseOne;
  return copy.outside(fieldLabel(rule, field), range);
}

/** What one box may hold, and what it counts: its key's own where the rule gives them, else the rule's. */
export function boundsOf(rule: NumberRule, key: string): { min: number; max: number; unit: string } {
  return rule.bounds?.[key] ?? { min: rule.min, max: rule.max, unit: rule.unit };
}

export const choiceLabel = (rule: ChoiceRule, choice: string): string =>
  copy.choiceNames[rule.name]?.[choice] ?? choice;

export const whole = (text: string, min: number, max: number): boolean => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
};

/** Figures read in words: an hour as the clock says it, typed on a 24-hour clock; a day by its name, 0 for Sunday. */
export const READ_AS: Readonly<Record<string, { readonly say: (figure: number) => string; readonly range: string }>> = {
  [HOUR_OF_DAY]: { say: copy.hour, range: copy.allowedHours },
  [DAY_OF_WEEK]: { say: copy.weekday, range: copy.allowedDays },
};

/** What a box may hold, as its error says it: "Enter 50–500 metres.", or "6 am to 10 pm, on a 24-hour clock". */
export function rangeWords(bounds: { min: number; max: number; unit: string }): string {
  const reading = READ_AS[bounds.unit];
  return reading === undefined
    ? copy.outOfBounds(String(bounds.min), copy.confirm.figure(bounds.max, bounds.unit))
    : copy.allowedWords(reading.say(bounds.min), reading.say(bounds.max), reading.range);
}

// A rule as ops type it in Settings' policies (./Rules.tsx): its draft, held as text, never as a number, since an empty
// box read as nought would be a radius no arrival passes; whether the draft is whole; what it would send; and each
// figure it moves, old beside new, for the check.

import { errorText } from "@maneman/web-kit/refusal";
import { DAY_OF_WEEK, HOUR_OF_DAY } from "@rules/config/setting-units.ts";
import type { ChoiceRule, NumberRule, OpsSetting, SettingValue } from "../api.ts";
import { settings } from "../content/settings.ts";

const copy = settings.rules;

/** One rule a Save would send: the figures typed, or null to put its standard figure back. */
export interface Change {
  readonly rule: OpsSetting;
  readonly value: SettingValue | null;
}

/** A rule's draft: the text in each box, or the choice, keyed as the value is. One number uses the rule's own name. */
export type Draft = Readonly<Record<string, string>>;

/** Each rule's draft in a section, by the rule's name. */
export type Drafts = Readonly<Record<string, Draft>>;

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

export const draftOf = (rule: OpsSetting): Draft =>
  typeof rule.value === "number"
    ? { [rule.name]: String(rule.value) }
    : Object.fromEntries(Object.entries(rule.value).map(([key, each]) => [key, String(each)]));

export const draftIn = (drafts: Drafts, rule: OpsSetting): Draft => drafts[rule.name] ?? draftOf(rule);

export const whole = (text: string, min: number, max: number): boolean => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) && value >= min && value <= max;
};

/** Whether every box holds what its key may take, so the draft can be sent. */
function isComplete(rule: OpsSetting, draft: Draft): boolean {
  if (rule.kind === "choice") {
    return Object.entries(draft).every(([key, choice]) => rule.choices[key]?.includes(choice) === true);
  }
  return Object.entries(draft).every(([key, text]) => {
    const { min, max } = boundsOf(rule, key);
    return whole(text, min, max);
  });
}

function valueOf(rule: OpsSetting, draft: Draft): SettingValue {
  if (rule.kind === "choice") return draft;
  return typeof rule.value === "number"
    ? Number(draft[rule.name])
    : Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, Number(text)]));
}

/** One figure a change moves: its box, and what it reads as now and would read as after, in the console's words. */
interface Moved {
  readonly key: string;
  readonly label: string;
  readonly was: string;
  readonly now: string;
}

/** Figures read in words: an hour as the clock says it, typed on a 24-hour clock; a day by its name, 0 for Sunday. */
export const READ_AS: Readonly<Record<string, { readonly say: (figure: number) => string; readonly range: string }>> = {
  [HOUR_OF_DAY]: { say: copy.hour, range: copy.allowedHours },
  [DAY_OF_WEEK]: { say: copy.weekday, range: copy.allowedDays },
};

/** What a box may hold, as its error says it: "Enter 50–500 metres.", or "6 am to 10 pm, on a 24-hour clock". */
export function rangeWords(bounds: { min: number; max: number; unit: string }): string {
  const reading = READ_AS[bounds.unit];
  return reading === undefined
    ? copy.outOfBounds(String(bounds.min), `${String(bounds.max)} ${bounds.unit}`)
    : copy.allowedWords(reading.say(bounds.min), reading.say(bounds.max), reading.range);
}

/** "6 pm" for an hour of the day, "Monday" for a day of the week; else the figure and its unit. */
function figureWords(figure: number, unit: string): string {
  return READ_AS[unit]?.say(figure) ?? copy.confirm.figure(figure, unit);
}

/** A number as the check reads it, with its unit. Null before is a base not yet named; null after, one unnamed. */
function numberWords(rule: NumberRule, key: string, figure: number | undefined, side: "was" | "now"): string {
  if (figure !== undefined) return figureWords(figure, boundsOf(rule, key).unit);
  return side === "was" ? copy.confirm.noFigure : copy.confirm.otherBases;
}

/** A box as the check names it: a keyed rule's box with its rule, since two rules may both have a First fit box. */
const checkLabel = (rule: OpsSetting, key: string): string => copy.confirm.keyed(rule.title, keyLabel(rule, key));

/** Each figure `next` would change, in the order the boxes are shown. */
export function movedBy(rule: OpsSetting, next: SettingValue): Moved[] {
  if (rule.kind === "choice") {
    const now = next as Readonly<Record<string, string>>;
    return rule.keys
      .filter((key) => rule.value[key] !== now[key])
      .map((key) => ({
        key: `${rule.name}.${key}`,
        label: checkLabel(rule, key),
        was: choiceLabel(rule, rule.value[key] ?? ""),
        now: choiceLabel(rule, now[key] ?? ""),
      }));
  }
  if (typeof rule.value === "number" || typeof next === "number") {
    const was = typeof rule.value === "number" ? rule.value : undefined;
    const now = typeof next === "number" ? next : undefined;
    if (now === undefined || was === now) return [];
    const words = (figure: number | undefined, side: "was" | "now") => numberWords(rule, rule.name, figure, side);
    return [{ key: rule.name, label: rule.title, was: words(was, "was"), now: words(now, "now") }];
  }
  const current = rule.value;
  const after = next as Readonly<Record<string, number>>;
  const keys = [...new Set([...Object.keys(current), ...Object.keys(after)])];
  return keys
    .filter((key) => current[key] !== after[key])
    .map((key) => ({
      key: `${rule.name}.${key}`,
      label: checkLabel(rule, key),
      was: numberWords(rule, key, current[key], "was"),
      now: numberWords(rule, key, after[key], "now"),
    }));
}

/** The rules whose boxes hold a figure that moves; none while any box holds what its rule cannot take. */
export function changesIn(rules: readonly OpsSetting[], drafts: Drafts): Change[] {
  if (rules.some((rule) => !isComplete(rule, draftIn(drafts, rule)))) return [];
  return rules
    .map((rule) => ({ rule, value: valueOf(rule, draftIn(drafts, rule)) }))
    .filter((change) => movedBy(change.rule, change.value).length > 0);
}

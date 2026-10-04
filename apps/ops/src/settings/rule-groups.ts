// Settings › Rules, by subject: each group is a section of its own, with its own anchor and its own Save.

import type { OpsSettingName } from "../../../../src/policy/ops-settings.ts";

interface RuleGroup {
  /** The section's anchor: "/settings#moves". */
  readonly id: string;
  /** Its rules, in the order the section shows them. */
  readonly rules: readonly OpsSettingName[];
}

export const RULE_GROUPS = [
  {
    id: "moves",
    rules: ["change_notice_hours", "late_change_charge", "no_show_charge", "no_show_waiver", "dispute_window_days"],
  },
  { id: "booking", rules: ["payment_hold", "booking_days"] },
  { id: "field", rules: ["checkin_radius_m", "no_show_wait_min", "phone_clock", "address_unlock_hour"] },
  { id: "reminders", rules: ["reminder_hour", "piece_cycle_days"] },
  { id: "referrals", rules: ["referral_reward"] },
  { id: "console", rules: ["task_sla_hours", "technician_work"] },
] as const satisfies readonly RuleGroup[];

/** Where a rule no group names is shown, so a rule the API adds is never left off the page. */
export const OTHER_GROUP = "other";

export type RuleGroupId = (typeof RULE_GROUPS)[number]["id"] | typeof OTHER_GROUP;

/** The group that also says what storage and the database hold. */
export const CONSOLE_GROUP: RuleGroupId = "console";

/** A section as the page draws it: a group, and those of its rules the API sent. */
export interface RuleSection<Rule> {
  readonly id: RuleGroupId;
  readonly rules: readonly Rule[];
}

/** The page's sections in RULE_GROUPS order, then any rule no group names. A group with none of its rules is left out. */
export function sectionsOf<Rule extends { readonly name: string }>(rules: readonly Rule[]): RuleSection<Rule>[] {
  const byName = new Map(rules.map((rule) => [rule.name, rule]));
  const grouped = new Set<string>(RULE_GROUPS.flatMap((group) => group.rules));
  const sections: RuleSection<Rule>[] = RULE_GROUPS.map((group) => ({
    id: group.id,
    rules: group.rules.flatMap((name) => byName.get(name) ?? []),
  }));
  sections.push({ id: OTHER_GROUP, rules: rules.filter((rule) => !grouped.has(rule.name)) });
  return sections.filter((section) => section.rules.length > 0);
}

/** A link to one rule, which Settings › Rules scrolls to once it has loaded. */
export const rulePath = (name: OpsSettingName): string => `/settings#${name}`;

/** The rules that charge a late fee, which is a price set in Prices, not a rule. */
export const CHARGES_A_LATE_FEE: readonly string[] = ["late_change_charge", "no_show_charge"];

// Settings' policies, by subject: each group is a panel of its own on the Settings page that names it (../route.ts,
// SETTINGS_PAGES), with its own anchor and its own change bar.

import type { OpsSettingName } from "@rules/policy/ops-settings.ts";

interface RuleGroup {
  /** The panel's anchor: "/settings/moves#moves". */
  readonly id: string;
  /** Its rules, in the order the section shows them. */
  readonly rules: readonly OpsSettingName[];
}

export const RULE_GROUPS = [
  {
    id: "moves",
    rules: ["change_notice_hours", "late_change_charge", "no_show_charge", "no_show_waiver", "dispute_window_days"],
  },
  { id: "booking", rules: ["payment_hold", "booking_days", "payment_links"] },
  {
    id: "field",
    rules: [
      "checkin_radius_m",
      "no_show_wait_min",
      "phone_clock",
      "address_unlock_hour",
      "arrival_notice_min",
      "move_proposal_hours",
    ],
  },
  { id: "reminders", rules: ["reminder_hour", "piece_cycle_days", "credit_reminder_days", "check_in_days"] },
  { id: "referrals", rules: ["referral_reward", "referral_monthly_cap"] },
  { id: "tryon", rules: ["tryon_look_days"] },
  { id: "care", rules: ["care_hours", "remedy_limit"] },
  { id: "reports", rules: ["lost_after_days"] },
  { id: "stock", rules: ["stock_watch", "stock_usage", "stock_quality", "cycle_counts", "kit_check"] },
  {
    id: "purchasing",
    rules: ["po_second_approval_above_rupees", "po_rupees_to_one", "custom_order_grace_days", "scorecard_days"],
  },
  { id: "supply_plan", rules: ["planning_period_days", "planning_horizon_periods", "forecast_assumptions"] },
  { id: "limits", rules: ["daily_ceilings"] },
  { id: "console", rules: ["task_sla_hours", "task_lapse_days", "technician_work"] },
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

/** The rules that charge a late fee, which is a price set in Prices, not a rule. */
export const CHARGES_A_LATE_FEE: readonly string[] = ["late_change_charge", "no_show_charge"];

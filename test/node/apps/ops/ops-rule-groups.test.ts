// Settings › Rules by subject (apps/ops/src/settings/rule-groups.ts). The rules
// were one page of seventeen, in no order a person would look for one.

import { describe, expect, it } from "vitest";
import { settings } from "../../../../apps/ops/src/content.ts";
import { OTHER_GROUP, RULE_GROUPS, rulePath, sectionsOf } from "../../../../apps/ops/src/settings/rule-groups.ts";
import { OPS_SETTINGS } from "../../../../src/policy/ops-settings.ts";

const rule = (name: string) => ({ name });

describe("the rules' groups", () => {
  it.each(OPS_SETTINGS.map((setting) => setting.name))("put %s in exactly one group", (name) => {
    const holding = RULE_GROUPS.filter((group) => (group.rules as readonly string[]).includes(name));
    expect(holding.map((group) => group.id)).toHaveLength(1);
  });

  it("name no rule the register does not hold", () => {
    const registered = new Set<string>(OPS_SETTINGS.map((setting) => setting.name));
    const unknown = RULE_GROUPS.flatMap((group) => group.rules).filter((name) => !registered.has(name));
    expect(unknown).toEqual([]);
  });

  it("each have a heading, and so does the section for any rule no group names", () => {
    const ids = [...RULE_GROUPS.map((group) => group.id), OTHER_GROUP];
    expect(Object.keys(settings.rules.groups).sort()).toEqual(ids.sort());
  });
});

describe("the page's sections", () => {
  it("follow the groups' order and each group's own order, whatever order the API sends", () => {
    const sections = sectionsOf([rule("referral_reward"), rule("no_show_charge"), rule("change_notice_hours")]);
    expect(sections).toEqual([
      { id: "moves", rules: [rule("change_notice_hours"), rule("no_show_charge")] },
      { id: "referrals", rules: [rule("referral_reward")] },
    ]);
  });

  it("show a rule no group names at the end, so none is left off the page", () => {
    const sections = sectionsOf([rule("a_new_rule"), rule("checkin_radius_m")]);
    expect(sections).toEqual([
      { id: "field", rules: [rule("checkin_radius_m")] },
      { id: OTHER_GROUP, rules: [rule("a_new_rule")] },
    ]);
  });

  it("show every rule the register holds exactly once", () => {
    const shown = sectionsOf(OPS_SETTINGS).flatMap((section) => section.rules.map((each) => each.name));
    expect(shown.sort()).toEqual(OPS_SETTINGS.map((setting) => setting.name).sort());
  });
});

describe("a link to one rule", () => {
  it("opens Settings at that rule", () => {
    expect(rulePath("late_change_charge")).toBe("/settings#late_change_charge");
  });
});

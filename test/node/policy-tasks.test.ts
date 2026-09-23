// The task queue, each rule named by the prompt's own words (src/policy/tasks.ts).
// The groups are queues the database already keeps, so the policy's job is to
// say which they are and how long each may wait.

import { describe, expect, it } from "vitest";
import { dueAt, RULES, TASK_GROUPS, TASK_SLA_HOURS } from "../../src/policy/tasks.ts";

/** A task starts waiting at 10:00 on Monday 21 September, in India. */
const SINCE = new Date("2026-09-21T04:30:00Z");

describe("tasks", () => {
  it(RULES[0], () => {
    expect(TASK_GROUPS).toContain("replacement_order");
  });

  it(RULES[1], () => {
    expect(TASK_GROUPS).toContain("referral_review");
  });

  it(RULES[2], () => {
    expect(TASK_GROUPS).toContain("no_show_decision");
  });

  it(RULES[3], () => {
    // One rule, two queues: a number change ops confirm, and an erasure they decide.
    expect(TASK_GROUPS).toContain("number_change");
    expect(TASK_GROUPS).toContain("erasure_request");
  });

  it("gives every group an allowance, all of them the placeholder two days", () => {
    for (const group of TASK_GROUPS) expect(TASK_SLA_HOURS[group], group).toBe(48);
    expect(Object.keys(TASK_SLA_HOURS).sort()).toEqual([...TASK_GROUPS].sort());
  });

  it("falls due its group's allowance after it started waiting", () => {
    expect(dueAt(SINCE, "referral_review")).toEqual(new Date("2026-09-23T04:30:00Z"));
  });

  it("names no group twice, so a task belongs to one queue", () => {
    expect(new Set(TASK_GROUPS).size).toBe(TASK_GROUPS.length);
  });
});

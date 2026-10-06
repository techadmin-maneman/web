// The task queue (src/policy/tasks.ts).
// The groups are queues the database already keeps, so the policy's job is to
// say which they are and how long each may wait.

import { describe, expect, it } from "vitest";
import {
  CLOSABLE_TASK_GROUPS,
  dueAt,
  isClosable,
  mayOwnTasks,
  TASK_GROUPS,
  TASK_SLA_HOURS,
} from "../../../src/policy/tasks.ts";

/** A task starts waiting at 10:00 on Monday 21 September, in India. */
const SINCE = new Date("2026-09-21T04:30:00Z");

describe("tasks", () => {
  it("queues the replacement orders", () => {
    expect(TASK_GROUPS).toContain("replacement_order");
  });

  // The review's reason is src/policy/decision-reasons.ts's rule; the queue it waits in is this one's.
  it("queues the grants the fraud rules held for review", () => {
    expect(TASK_GROUPS).toContain("referral_review");
  });

  it("queues the no-shows for ops to charge or waive", () => {
    expect(TASK_GROUPS).toContain("no_show_decision");
  });

  // A disputed charge once waited on No-shows alone, with no row, count or link on the Tasks board.
  it("queues a client's dispute of a no-show's charge, with two days to rule on it", () => {
    expect(TASK_GROUPS).toContain("no_show_dispute");
    expect(TASK_SLA_HOURS.no_show_dispute).toBe(48);
  });

  it("queues number changes to confirm and deletion requests to decide", () => {
    // One rule, two queues: a number change ops confirm, and an erasure they decide.
    expect(TASK_GROUPS).toContain("number_change");
    expect(TASK_GROUPS).toContain("erasure_request");
  });

  // A visit left partly done made no task.
  it("queues a visit left partly done", () => {
    expect(TASK_GROUPS).toContain("partial_visit");
  });

  // Not one of the prompt's rules: the queue is new, and it is here because a
  // consultation asked for while self-serve booking is off is work for ops
  // (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
  it("queues a consultation asked for while self-serve booking is off", () => {
    expect(TASK_GROUPS).toContain("consultation_request");
  });

  it("gives every group an allowance, the placeholder two days but where something else is promised", () => {
    const promised: Partial<Record<string, number>> = {
      // A client who does not know his visit moved will not be home for it (ADR 0069).
      untold_move: 4,
      // "The 30 days run from the client's request to ops' decision" (ADR 0049).
      erasure_request: 30 * 24,
      // The client's app: "within 30 days at the latest" (docs/open-points.md, item 51).
      grievance: 30 * 24,
      // Money owed back to a client: refunded within the day.
      payment_to_refund: 24,
    };
    for (const group of TASK_GROUPS) expect(TASK_SLA_HOURS[group], group).toBe(promised[group] ?? 48);
    expect(Object.keys(TASK_SLA_HOURS).sort()).toEqual([...TASK_GROUPS].sort());
  });

  // A client's grievance waits for an answer as their erasure waits for a decision.
  it("counts down an open grievance, as it does the other requests about a client's own data", () => {
    expect(TASK_GROUPS).toContain("grievance");
  });

  it("falls due its group's allowance after it started waiting", () => {
    expect(dueAt(SINCE, "referral_review")).toEqual(new Date("2026-09-23T04:30:00Z"));
  });

  it("names no group twice, so a task belongs to one queue", () => {
    expect(new Set(TASK_GROUPS).size).toBe(TASK_GROUPS.length);
  });

  // The members of staff are those who have signed in to the
  // console, as Access named them (src/domain/task-owners.ts).
  it("lets a task be owned only by someone on the Staff list, whatever the case of their e-mail", () => {
    const staff = ["anil@maneman.in", "priya@maneman.in"];
    expect(mayOwnTasks("priya@maneman.in", staff)).toBe(true);
    // Access gives every e-mail in lower case; one typed otherwise is the same member of staff.
    expect(mayOwnTasks("Priya@Maneman.in", staff)).toBe(true);
    expect(mayOwnTasks("priya@maneman.com", staff)).toBe(false);
  });

  // Every other task leaves the board only when its thing is done.
  it("lets ops close a partial visit's task without a follow-up, and no other", () => {
    expect(CLOSABLE_TASK_GROUPS).toEqual(["partial_visit"]);
    expect(TASK_GROUPS.filter(isClosable)).toEqual(["partial_visit"]);
  });
});

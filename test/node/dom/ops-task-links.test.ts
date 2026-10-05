// Where a task leads in the console (apps/ops/src/lib/task-links.ts): the client's page on the tab the task is about, and
// the row it is decided on.

import { describe, expect, it } from "vitest";
import type { Task } from "../../../apps/ops/src/api.ts";
import { CLIENT_TABS } from "../../../apps/ops/src/route.ts";
import { decidedAt, taskClientPath, taskTabOf } from "../../../apps/ops/src/lib/task-links.ts";
import { TASK_GROUPS } from "../../../src/policy/tasks.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";

const task = (id: string): Task => ({
  id,
  person: { id: CLIENT, name: "Rohit Malhotra" },
  detail: null,
  since: "2027-09-21T06:00:00.000Z",
  due: "2027-09-23T06:00:00.000Z",
  owner: null,
});

// A bare link to a client opened their Pieces, whatever the task was about.
describe("where a task leads", () => {
  it("leads every group to a tab the client's page has", () => {
    for (const group of TASK_GROUPS) {
      expect(CLIENT_TABS, group).toContain(taskTabOf(group));
    }
  });

  it("opens the client's page on the tab the task is about", () => {
    expect(taskClientPath("first_fit_to_book", CLIENT)).toBe(`/clients/${CLIENT}/visits`);
    expect(taskClientPath("referral_review", CLIENT)).toBe(`/clients/${CLIENT}/visits`);
    expect(taskClientPath("replacement_order", CLIENT)).toBe(`/clients/${CLIENT}/pieces`);
    expect(taskClientPath("payment_owed", CLIENT)).toBe(`/clients/${CLIENT}/payments`);
    expect(taskClientPath("grievance", CLIENT)).toBe(`/clients/${CLIENT}/consents`);
  });

  it("leads a task decided in its own section to its row there, and one done on the client's page nowhere else", () => {
    expect(decidedAt("number_change", task("94000000-0000-4000-8000-000000000001"))).toBe(
      "/number-changes#change-94000000-0000-4000-8000-000000000001",
    );
    expect(decidedAt("replacement_order", task("91000000-0000-4000-8000-000000000001"))).toBeNull();
  });
});

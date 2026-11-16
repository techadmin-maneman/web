// Where a task leads in the console (apps/ops/src/lib/task-links.ts): the client's page on the tab the task is about, and
// the row it is decided on.

import { describe, expect, it } from "vitest";
import type { Task } from "../../../../../apps/ops/src/api.ts";
import { CLIENT_TABS } from "../../../../../apps/ops/src/route.ts";
import { decidedAt, taskClientPath, taskTabOf } from "../../../../../apps/ops/src/lib/task-links.ts";
import { subOf } from "../../../../../apps/ops/src/tasks/task-subs.ts";
import { TASK_GROUPS } from "../../../../../src/policy/tasks.ts";

const CLIENT = "22000000-0000-4000-8000-000000000001";

const task = (id: string): Task => ({
  id,
  person: { id: CLIENT, name: "Rohit Malhotra" },
  facts: { group: "grievance" },
  detail: null,
  since: "2027-09-21T06:00:00.000Z",
  due: "2027-09-23T06:00:00.000Z",
  owner: null,
});

// A bare link to a client opened their Pieces, whatever the task was about.
describe("where a task leads", () => {
  it("leads every group to a tab the client’s page has", () => {
    for (const group of TASK_GROUPS) {
      expect(CLIENT_TABS, group).toContain(taskTabOf(group));
    }
  });

  it("opens the client’s page on the tab the task is about", () => {
    expect(taskClientPath("first_fit_to_book", CLIENT)).toBe(`/clients/${CLIENT}/visits`);
    expect(taskClientPath("referral_review", CLIENT)).toBe(`/clients/${CLIENT}/visits`);
    expect(taskClientPath("replacement_order", CLIENT)).toBe(`/clients/${CLIENT}/pieces`);
    expect(taskClientPath("payment_owed", CLIENT)).toBe(`/clients/${CLIENT}/payments`);
    expect(taskClientPath("grievance", CLIENT)).toBe(`/clients/${CLIENT}/consents`);
  });

  it("leads a task decided in its own section to its row there, and one done on the client’s page nowhere else", () => {
    expect(decidedAt("number_change", task("94000000-0000-4000-8000-000000000001"))).toBe(
      "/number-changes#change-94000000-0000-4000-8000-000000000001",
    );
    expect(decidedAt("replacement_order", task("91000000-0000-4000-8000-000000000001"))).toBeNull();
  });
});

describe("a fit guarantee claim (docs/decisions/0258-the-issue-log.md)", () => {
  const CHAT = "8c1d9f4b-5e6a-4b7c-9d8e-3f4a5b6c7d8e";
  const claim = (conversation: string | null, signOff: "signed" | null, photos: number): Task => ({
    ...task("c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f"),
    facts: {
      group: "fit_guarantee_claim",
      reference: "MM-ISS-0002",
      fitted_on: "2027-09-18",
      sign_off: signOff,
      conversation_id: conversation,
      photos,
      references: ["MM-ISS-0002"],
    },
  });

  it("leads to the client's chat, and nowhere while they have none", () => {
    expect(decidedAt("fit_guarantee_claim", claim(CHAT, "signed", 2))).toBe(`/messages#chat-${CHAT}`);
    expect(decidedAt("fit_guarantee_claim", claim(null, "signed", 2))).toBeNull();
  });

  it("reads its reference, the fit's day, where the sign-off stood and the photographs sent", () => {
    const now = new Date("2027-09-22T05:00:00.000Z");
    expect(subOf(claim(CHAT, "signed", 2), now)).toBe("MM-ISS-0002 · fitted Sat 18 Sep · signed off · 2 photos");
    expect(subOf(claim(CHAT, null, 1), now)).toBe("MM-ISS-0002 · fitted Sat 18 Sep · no sign-off · 1 photo");
    expect(subOf(claim(CHAT, null, 0), now)).toBe("MM-ISS-0002 · fitted Sat 18 Sep · no sign-off");
  });
});

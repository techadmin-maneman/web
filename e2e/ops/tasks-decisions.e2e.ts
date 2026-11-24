// Tasks decided in their own drawer (apps/ops/src/tasks/TaskDetail.tsx): a technician's ask for leave, and a remedy
// past Care's limit, each approved there by one who may, never only in Settings. Every name is made up.

import { expect, test } from "../support.ts";
import { empty, json, type OpsReply } from "./fixtures.ts";
import { detail, kindsListed, NO_ALERTS, open, PLAIN, row } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

// A technician's ask for leave from their phone, decided from its drawer: Approve records the leave.
test("approves a technician’s ask for leave from its drawer", async ({ page }) => {
  const id = "97000000-0000-4000-8000-000000000001";
  const board: OpsReply<"/api/tasks"> = {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
    staff: [],
    groups: [
      {
        group: "leave_request",
        count: 1,
        ...PLAIN,
        tasks: [
          {
            id,
            person: null,
            facts: {
              group: "leave_request",
              technician: "Imran Qureshi",
              from: "2027-09-26",
              to: "2027-09-28",
              note: "Sister’s wedding",
            },
            detail: "2027-09-26 Imran Qureshi",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-22T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  const decided: unknown[] = [];
  await open(page, board, NO_ALERTS, {
    "POST /api/leave-requests/{id}/decision": async (route) => {
      decided.push(route.request().postDataJSON());
      await empty()(route);
    },
  });
  await expect.poll(() => kindsListed(page)).toEqual([opsCopy.tasks.groups.leave_request].sort());
  await expect(row(page, "Imran Qureshi")).toContainText("Sister’s wedding");
  const drawer = await detail(page, "Imran Qureshi");
  await drawer.getByRole("button", { name: opsCopy.tasks.leave.approve }).click();
  await expect.poll(() => decided).toEqual([{ decision: "approved" }]);
});

// A remedy past Care's limit, decided from its drawer by one who may approve it, never only in Settings
// (docs/decisions/0315-a-remedy-past-the-limit-given-by-one-who-may-approve-it.md).
test("approves a remedy past the limit from its drawer, with no way to Settings", async ({ page }) => {
  const id = "97000000-0000-4000-8000-000000000021";
  const board: OpsReply<"/api/tasks"> = {
    overdue: 0,
    truncated: false,
    low_stock_places: 0,
    lapsed: 0,
    staff: [],
    groups: [
      {
        group: "remedy_approval",
        count: 1,
        ...PLAIN,
        tasks: [
          {
            id,
            person: { id: "11000000-0000-4000-8000-000000000031", name: "Kabir Sethi" },
            facts: { group: "remedy_approval", visits: 2, reason: "technician_late" },
            detail: "2 Kabir Sethi",
            since: "2027-09-21T06:00:00.000Z",
            due: "2027-09-22T06:00:00.000Z",
            owner: null,
          },
        ],
      },
    ],
  };
  const approved: string[] = [];
  await open(page, board, NO_ALERTS, {
    "POST /api/remedies/{id}/approve": async (route) => {
      approved.push(route.request().url());
      await json({ ok: true })(route);
    },
  });
  const drawer = await detail(page, "Kabir Sethi");
  await expect(drawer.getByRole("link", { name: /Remedies/ })).toHaveCount(0);
  await drawer.getByRole("button", { name: opsCopy.tasks.remedy.approve }).click();
  await expect.poll(() => approved).toEqual([expect.stringContaining(`/api/remedies/${id}/approve`)]);
});

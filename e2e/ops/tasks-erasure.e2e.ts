// An erasure's leftovers in Zoho on the Tasks board (docs/decisions/0066-erasure-all-or-nothing.md): the CRM record's
// history and its recycle bin, which Care finish by hand and close once done.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { empty, type OpsReply } from "./fixtures.ts";
import { kindsListed, NO_ALERTS, open } from "./tasks-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

/** Two erasures Care finish in Zoho: one whose lead is named, and one that never reached Zoho. */
export const ERASURE_BOARD: OpsReply<"/api/tasks"> = {
  overdue: 0,
  truncated: false,
  low_stock_places: 0,
  lapsed: 0,
  staff: [],
  groups: [
    {
      group: "erasure_follow_up",
      count: 2,
      closable: true,
      tasks: [
        {
          id: "99000000-0000-4000-8000-000000000001",
          person: null,
          facts: { group: "erasure_follow_up", lead: "610500000001", person: "11000000-0000-4000-8000-000000000001" },
          detail: "610500000001",
          since: "2027-09-21T06:00:00.000Z",
          due: "2027-09-21T14:00:00.000Z",
          owner: null,
        },
        {
          id: "99000000-0000-4000-8000-000000000002",
          person: null,
          facts: { group: "erasure_follow_up", lead: null, person: "11000000-0000-4000-8000-000000000002" },
          detail: null,
          since: "2027-09-21T07:00:00.000Z",
          due: "2027-09-21T15:00:00.000Z",
          owner: null,
        },
      ],
    },
  ],
};

// Erasure blanks the CRM fields but leaves their history and the recycle bin.
test("lists an erasure's leftovers in Zoho, naming the lead, and closes one once done", async ({ page }) => {
  const closed: unknown[] = [];
  await open(page, ERASURE_BOARD, NO_ALERTS, {
    "POST /api/tasks/{group}/{id}/close": async (route) => {
      closed.push({ url: new URL(route.request().url()).pathname, body: route.request().postDataJSON() as unknown });
      await empty()(route);
    },
  });
  await expect.poll(() => kindsListed(page)).toEqual([opsCopy.tasks.groups.erasure_follow_up]);
  const lead = opsCopy.tasks.subs.erasure_follow_up("610500000001", "11000000-0000-4000-8000-000000000001");
  await expect(page.getByText(lead)).toBeVisible();
  await expect(
    page.getByText(opsCopy.tasks.subs.erasure_follow_up(null, "11000000-0000-4000-8000-000000000002")),
  ).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: lead }).click();
  const drawer = page.getByRole("dialog", { name: opsCopy.tasks.disputeErased });
  await drawer.getByRole("button", { name: opsCopy.tasks.close.erasureFollowUp.open }).click();
  // Nothing is asked of ops: the person is erased, and no words are kept about them.
  await expect(drawer.getByRole("textbox")).toHaveCount(0);
  await drawer.getByRole("button", { name: opsCopy.tasks.close.confirm }).click();
  await expect
    .poll(() => closed)
    .toEqual([
      {
        url: "/api/tasks/erasure_follow_up/99000000-0000-4000-8000-000000000001/close",
        body: { reason: opsCopy.tasks.close.erasureFollowUp.open },
      },
    ]);
});

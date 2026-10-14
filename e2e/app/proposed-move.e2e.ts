// A move to another day ops asked the client to confirm (docs/decisions/0115-a-move-to-another-day-waits-for-the-client.md),
// laid over the fitted client's next visit as the local API reads it: Home asks, Accept answers, and Reschedule offers
// another time beside it. The proposal itself, and accepting it, are test/worker/ops/dispatch-proposals.test.ts's.

import type { Page } from "@playwright/test";
import { shortDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { passedThrough } from "./booking-fixtures.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

const PROPOSED = "2099-01-06";

/** The API's own answer for Home, with a move proposed on the next visit. */
async function proposeOnHome(page: Page): Promise<void> {
  await passedThrough(page, "**/api/me", (me: { next_visit?: Record<string, unknown> | null }) => {
    // Before the client signs in, the answer is a refusal, with no visit to change.
    if (me.next_visit === undefined || me.next_visit === null) return me;
    return {
      ...me,
      next_visit: {
        ...me.next_visit,
        proposed_move: {
          id: "6a000000-0000-4000-8000-000000000001",
          date: PROPOSED,
          window: "morning",
          hours: { start: "09:00", end: "12:00" },
          technician: { name: "Sameer Bhatt", initials: "SB" },
          expires_at: "2099-01-05T06:30:00.000Z",
        },
      },
    };
  });
}

// A request still passing through when a test ends is let go, rather than failing the test it outlived.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Home asks the client to confirm a move ops proposed, beside another time of their own", async ({ page }) => {
  await proposeOnHome(page);
  const accepted: string[] = [];
  await page.route("**/api/visits/*/proposed-move/accept", (route) => {
    accepted.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { moved: true } });
  });
  await logIn(page, fittedClient().mobile);

  const when = `${shortDate(PROPOSED)}, 9 am–12 noon`;
  await expect(page.getByText(`We need to move this visit. Could you do ${when} with Sameer instead?`)).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.proposal.pick })).toBeVisible();
  await expect(page.getByRole("button", { name: appCopy.home.reschedule })).toHaveCount(0);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: `Accept ${shortDate(PROPOSED)}` }).click();
  await expect.poll(() => accepted).toEqual([`/api/visits/${fittedClient().next.id}/proposed-move/accept`]);
});

test("a proposed time taken since says so, and leaves the client to pick another", async ({ page }) => {
  await proposeOnHome(page);
  await page.route("**/api/visits/*/proposed-move/accept", (route) =>
    route.fulfill({ status: 409, json: { error: { code: "move_gone", request_id: "r" } } }),
  );
  await logIn(page, fittedClient().mobile);

  await page.getByRole("button", { name: `Accept ${shortDate(PROPOSED)}` }).click();
  await expect(page.getByText("That time has just gone. Pick another.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Accept / })).toHaveCount(0);
  await page.getByRole("button", { name: appCopy.home.proposal.pick }).click();
  await expect(page.getByRole("dialog", { name: /^Move \w+day’s visit$/ })).toBeVisible();
});

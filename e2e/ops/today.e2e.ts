// Today: a home for each kind of work a person's grants reach (ADR 0227), with a choice between them where there are
// several: the home's figures, what needs the person from their board, and the home's own list beside it.

import { expect, test } from "../support.ts";
import { answer, BOARD, json, TASKS, type OpsReply } from "./fixtures.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { care } from "../../apps/ops/src/content/care.ts";
import { tasks } from "../../apps/ops/src/content/tasks.ts";
import { today as copy } from "../../apps/ops/src/content/today.ts";

// Friday 19 September 2025, 12 noon in India: the board's first day, its morning visits begun at 9 and nobody there.
const NOON = new Date("2025-09-19T06:30:00.000Z");

const CARE = {
  from: "2025-09-12",
  to: "2025-09-19",
  replies: { chats: 12, median_minutes: 42, within_target: 0.75 },
  same_day: 50,
  backlog: { waiting_on_us: 3, overdue: 1, waiting_on_client: 2 },
  reasons: [],
  remedies: [],
  by_person: [],
} satisfies OpsReply<"/api/care-numbers">;

const WAITING = {
  conversations: [
    {
      id: "7c000000-0000-4000-8000-000000000001",
      person: { id: "22000000-0000-4000-8000-000000000002", name: "Kunal Mehta" },
      mobile: "+919812345678",
      state: "open",
      care_person: null,
      care_name: null,
      technician: null,
      covered_by: null,
      last_message_at: "2025-09-19T05:30:00.000Z",
      last_line: "The front is lifting",
      waiting_since: "2025-09-19T05:30:00.000Z",
      reply_by: "2025-09-19T06:00:00.000Z",
    },
  ],
  next_cursor: null,
} satisfies OpsReply<"/api/conversations">;

const homes = (page: import("@playwright/test").Page) => page.getByRole("radiogroup", { name: copy.homes.label });

test("opens on Dispatch's home: today's visits, those running late, and the visits still to come beside", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, { "GET /api/tasks": json(TASKS), "GET /api/dispatch": json(BOARD) });
  await page.goto("/today");
  await expect(page.getByText("Friday 19 September · All cities", { exact: true })).toBeVisible();
  // While the Staff list is not enforced, every home is offered.
  await expect(homes(page).getByRole("radio")).toHaveCount(5);
  await expect(homes(page).getByRole("radio", { name: copy.homes.names.dispatch })).toBeChecked();

  // A tile is named by its label, then its figure; a row beside it by its time first.
  const tile = (label: string) => page.getByRole("main").getByRole("link", { name: new RegExp(`^${label}`) });
  await expect(tile(copy.tiles.visits)).toContainText("4");
  await expect(tile(copy.road.late)).toContainText("3");
  const road = page.getByRole("region", { name: copy.road.title });
  await expect(road.getByRole("listitem")).toHaveCount(4);
  await expect(road.getByRole("listitem").first()).toContainText(copy.road.late);
  // None of the board's tasks is Dispatch's: its replacements are Inventory's, its referrals Growth's.
  await expect(page.getByRole("region", { name: copy.needs })).toContainText(copy.none);
});

test("lists each home's own tasks under Needs you, and Care's replies and chats waiting on us", async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, {
    "GET /api/tasks": json(TASKS),
    "GET /api/dispatch": json(BOARD),
    "GET /api/care-numbers": json(CARE),
    "GET /api/conversations": json(WAITING),
  });
  await page.goto("/today");
  await homes(page).getByRole("radio", { name: copy.homes.names.inventory }).click();
  const needs = page.getByRole("region", { name: copy.needs });
  await expect(needs.getByRole("listitem").first()).toContainText(tasks.groups.replacement_order);

  await homes(page).getByRole("radio", { name: copy.homes.names.care }).click();
  await expect(needs).toContainText(tasks.groups.number_change);
  await expect(needs).not.toContainText(tasks.groups.replacement_order);
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^${copy.care.median}`) })).toContainText(
    copy.care.minutes(42),
  );
  const chats = page.getByRole("region", { name: care.views.open });
  await expect(chats.getByRole("listitem")).toHaveCount(1);
  await expect(chats).toContainText(care.overdue("11:30 am"));
});

test("offers a person whose grants are in one city the City head's home first, and only their own", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, {
    "GET /api/whoami": json({
      signed_in_as: "meera@maneman.in",
      sign_out: null,
      staff: {
        enforced: true,
        listed: true,
        grants: [{ department: "operations", level: "act", geography: "city", place: "Gurgaon" }],
        may_call: Object.keys(ROUTE_NEEDS),
      },
      cities: ["Gurgaon"],
    } satisfies OpsReply<"/api/whoami">),
    "GET /api/tasks": json(TASKS),
    "GET /api/dispatch": json(BOARD),
  });
  await page.goto("/today");
  await expect(homes(page).getByRole("radio")).toHaveText([
    copy.homes.names.city,
    copy.homes.names.dispatch,
    copy.homes.names.inventory,
  ]);
  await expect(homes(page).getByRole("radio", { name: copy.homes.names.city })).toBeChecked();
});

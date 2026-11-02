// Today: the one home a person's grants give them (ADR 0227, ADR 0238): the home's figures, what needs the person from
// their board, and the home's own list beside it.

import { expect, test } from "../support.ts";
import { answer, BOARD, json, TASKS, type OpsReply } from "./fixtures.ts";
import { ROUTE_NEEDS } from "../../src/policy/console-routes.ts";
import { care } from "../../apps/ops/src/content/care.ts";
import { shell, tables } from "../../apps/ops/src/content.ts";
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

/** Who is signed in, with one grant across the country, or in one city. */
const signedIn = (department: "operations" | "customer_care", place: string | null = null) =>
  json({
    signed_in_as: "meera@maneman.in",
    sign_out: null,
    staff: {
      enforced: true,
      listed: true,
      grants: [{ department, level: "act", geography: place === null ? "national" : "city", place }],
      may_call: Object.keys(ROUTE_NEEDS),
    },
    cities: place === null ? ["Gurgaon", "Delhi"] : [place],
    every_city: place === null,
  } satisfies OpsReply<"/api/whoami">);

test("opens on Dispatch's home: today's visits, those running late, and the visits still to come beside", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, { "GET /api/tasks": json(TASKS), "GET /api/dispatch": json(BOARD) });
  await page.goto("/today");
  await expect(page.getByText("Friday 19 September · All cities", { exact: true })).toBeVisible();
  // While the Staff list is not enforced, everyone opens on Dispatch's home, with no choice of another.
  await expect(page.getByRole("radiogroup")).toHaveCount(0);

  // A tile is named by its label, then its figure; a row beside it by its time first.
  const tile = (label: string) => page.getByRole("main").getByRole("link", { name: new RegExp(`^${label}`) });
  await expect(tile(copy.tiles.visits)).toContainText("4");
  await expect(tile(copy.road.late)).toContainText("3");
  // The longest late of the three begun at 9, three hours ago, and the day's sentence: no visit today is unassigned.
  await expect(tile(copy.road.late)).toContainText(copy.notes.late("Imran Qureshi", 180));
  await expect(tile(copy.tiles.visits)).toContainText(copy.notes.road(0, 0));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.greeting.dispatch(0));
  const road = page.getByRole("region", { name: copy.road.title });
  await expect(road.getByRole("listitem")).toHaveCount(4);
  await expect(road.getByRole("listitem").first()).toContainText(copy.road.late);
  // Needs you lists the person's whole board: stock's replacements too, as no other home takes them.
  await expect(page.getByRole("region", { name: copy.needs })).toContainText(tasks.groups.replacement_order);
});

test("opens Customer Care on Care's home: their board under Needs you, and the chats waiting on us", async ({
  page,
}) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, {
    "GET /api/whoami": signedIn("customer_care"),
    "GET /api/tasks": json(TASKS),
    "GET /api/dispatch": json(BOARD),
    "GET /api/care-numbers": json(CARE),
    "GET /api/conversations": json(WAITING),
  });
  await page.goto("/today");
  const needs = page.getByRole("region", { name: copy.needs });
  await expect(needs).toContainText(tasks.groups.number_change);
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^${copy.care.median}`) })).toContainText(
    copy.care.minutes(42),
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.greeting.care(0));
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^${copy.tiles.chats}`) })).toContainText(
    copy.notes.oldest(60),
  );
  const chats = page.getByRole("region", { name: care.views.open });
  await expect(chats.getByRole("listitem")).toHaveCount(1);
  await expect(chats).toContainText(care.overdue("11:30 am"));
});

test("opens a person whose grants are in one city on the City head's home", async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  await answer(page, {
    "GET /api/whoami": signedIn("operations", "Gurgaon"),
    "GET /api/tasks": json(TASKS),
    "GET /api/dispatch": json(BOARD),
  });
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/booked today\.$/);
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
});

test("offers a city head their one city in the header, and reads the board for it", async ({ page }) => {
  await page.clock.setFixedTime(NOON);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/tasks") asked.push(new URL(request.url()).search);
  });
  await answer(page, {
    "GET /api/whoami": json({
      signed_in_as: "meera@maneman.in",
      sign_out: null,
      staff: {
        enforced: true,
        listed: true,
        grants: [{ department: "operations", level: "manage", geography: "city", place: "Gurgaon" }],
        may_call: Object.keys(ROUTE_NEEDS),
      },
      cities: ["Gurgaon"],
      every_city: false,
    } satisfies OpsReply<"/api/whoami">),
    "GET /api/tasks": json(TASKS),
    "GET /api/dispatch": json(BOARD),
  });
  await page.goto("/today");
  const picker = page.getByRole("banner").getByRole("button", { name: shell.city.label("Gurgaon") });
  await picker.click();
  await expect(page.getByRole("banner").getByRole("button", { name: tables.allCities })).toHaveCount(0);
  await expect(page.getByText("Friday 19 September · Gurgaon", { exact: true })).toBeVisible();
  await expect.poll(() => asked.at(-1)).toBe("?city=Gurgaon");
});

// Today: tiles with no date, everyone's oldest tasks under "Needs you", and nothing of the day on the road, Care's
// replies or Growth's numbers. It is dated now, a part for each kind of work, and one's own tasks first.

import { expect, test } from "../support.ts";
import { answer, BOARD, json, TASKS, type OpsReply } from "./fixtures.ts";
import { today as copy } from "../../apps/ops/src/content/today.ts";

const CARE = {
  from: "2025-09-12",
  to: "2025-09-19",
  replies: { chats: 12, median_minutes: 42, within_target: 75 },
  same_day: 50,
  backlog: { waiting_on_us: 3, overdue: 1, waiting_on_client: 2 },
  reasons: [],
  remedies: [],
  by_person: [],
} satisfies OpsReply<"/api/care-numbers">;

const NONE = { leads: 0, booked: 0, consulted: 0, fitted: 0 };

const FUNNEL = {
  from: "2025-08-21",
  to: "2025-09-19",
  tryons: 40,
  steps: { leads: 10, booked: 6, consulted: 4, fitted: 2 },
  channels: [{ channel: "Direct", ...NONE }],
} satisfies OpsReply<"/api/growth/funnel">;

test("dates the day, and gives the road, Care and Growth a part each for those whose access reaches them", async ({
  page,
}) => {
  // Friday 19 September 2025, 12 noon in India: the board's first day.
  await page.clock.setFixedTime(new Date("2025-09-19T06:30:00.000Z"));
  await answer(page, {
    "GET /api/tasks": json({ ...TASKS, overdue: 0 }),
    "GET /api/dispatch": json(BOARD),
    "GET /api/care-numbers": json(CARE),
    "GET /api/growth/funnel": json(FUNNEL),
  });
  await page.goto("/today");
  await expect(page.getByText("19 Sep 2025", { exact: true })).toBeVisible();

  const road = page.getByRole("region", { name: copy.road.title });
  await expect(road.getByRole("link")).toHaveCount(5);
  await expect(page.getByRole("region", { name: copy.care.title })).toContainText(copy.care.minutes(42));
  await expect(page.getByRole("region", { name: copy.growth.title })).toContainText(copy.growth.fitted);
});

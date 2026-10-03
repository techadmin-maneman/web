// What the console's two boards read from D1 in a day, at the cadence the console's own code reads them
// (scripts/lib/free-tier-budget.ts). The dispatch board grows with the visits in its week; past the requests' share
// D1 refuses every query until midnight UTC, for the site and the apps as well.

import { describe, expect, it } from "vitest";
import { REFRESH_MS } from "../../apps/ops/src/dispatch/useBoard.ts";
import { FRESH_MS } from "../../apps/ops/src/lib/waiting.ts";
import {
  BOARD_ROWS_READ_FIXED,
  BOARD_ROWS_READ_PER_VISIT,
  CRON_READ_SHARE,
  FREE_TIER,
  HEADROOM,
  OTHER_REQUESTS_ROWS_READ_PER_DAY,
  REQUEST_READ_SHARE,
  ROUTE_ROWS_READ,
  TASKS_ROWS_READ_PER_LOOK,
  consoleRowsReadPerDay,
  consoleRunwayVisits,
  readsPerWorkingDay,
} from "../../scripts/lib/free-tier-budget.ts";

const TODAY = { boardRefreshMs: REFRESH_MS, tasksFreshMs: FRESH_MS };
/** The visits in a week at 2,000 clients, each seen about every 30 days. */
const VISITS_IN_WEEK_AT_2000_CLIENTS = 470;

describe("the console's boards in the day's reads", () => {
  it("reads each board 1,200 times a day: two staff, ten hours, once a minute", () => {
    expect(readsPerWorkingDay(TODAY.boardRefreshMs)).toBe(1_200);
    expect(readsPerWorkingDay(TODAY.tasksFreshMs)).toBe(1_200);
  });

  it("gives requests what the 80% leaves after the cron's share", () => {
    expect(REQUEST_READ_SHARE).toBeCloseTo(HEADROOM - CRON_READ_SHARE);
    expect(FREE_TIER.d1RowsReadPerDay * REQUEST_READ_SHARE).toBe(2_000_000);
  });

  it("leaves room for 39 visits in the board's week while the board reads itself every minute", () => {
    expect(consoleRunwayVisits(TODAY)).toBe(39);
  });

  it("lets a release's soak pass a board load of no more than those visits", () => {
    const load = BOARD_ROWS_READ_FIXED + BOARD_ROWS_READ_PER_VISIT * consoleRunwayVisits(TODAY);
    expect(ROUTE_ROWS_READ["/api/dispatch"]).toBe(load);
    expect(ROUTE_ROWS_READ["/api/tasks"]).toBe(TASKS_ROWS_READ_PER_LOOK);
  });

  it("passes the requests' share long before 2,000 clients at that cadence", () => {
    const share = FREE_TIER.d1RowsReadPerDay * REQUEST_READ_SHARE - OTHER_REQUESTS_ROWS_READ_PER_DAY;
    expect(consoleRowsReadPerDay(VISITS_IN_WEEK_AT_2000_CLIENTS, TODAY)).toBeGreaterThan(share);
  });

  it("has more room the less often the board reads itself", () => {
    const everyFiveMinutes = { ...TODAY, boardRefreshMs: 5 * 60_000 };
    expect(consoleRunwayVisits(everyFiveMinutes)).toBeGreaterThan(5 * consoleRunwayVisits(TODAY));
  });
});

// What the console's two boards read from D1 in a day, at the cadence the console's own code reads them
// (scripts/lib/free-tier-budget.ts). The dispatch board grows with the visits in its week; past the requests' share
// D1 refuses every query until midnight UTC, for the site and the apps as well.

import { describe, expect, it } from "vitest";
import { FULL_READ_MS, POLL_MS } from "../../../apps/ops/src/dispatch/useBoard.ts";
import { FRESH_MS } from "../../../apps/ops/src/lib/waiting.ts";
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
  boardReadsPerWorkingDay,
  consoleRowsReadPerDay,
  consoleRunwayVisits,
  readsPerWorkingDay,
} from "../../../scripts/lib/free-tier-budget.ts";

const TODAY = { boardPollMs: POLL_MS, boardFullReadMs: FULL_READ_MS, tasksFreshMs: FRESH_MS };
/** As the board was until 4 October 2026: read in full every minute. */
const EVERY_MINUTE = { ...TODAY, boardFullReadMs: POLL_MS };
/** The visits in a week at 2,000 clients, each seen about every 30 days. */
const VISITS_IN_WEEK_AT_2000_CLIENTS = 470;

describe("the console's boards in the day's reads", () => {
  it("looks at the board's version, and at Tasks, 1,200 times a day: two staff, ten hours, once a minute", () => {
    expect(readsPerWorkingDay(TODAY.boardPollMs)).toBe(1_200);
    expect(readsPerWorkingDay(TODAY.tasksFreshMs)).toBe(1_200);
  });

  it("reads the board in full every ten minutes, and again for each change to it", () => {
    expect(boardReadsPerWorkingDay(0, TODAY)).toBe(120);
    // 70 visits a week make 50 changes a day, each read by both staff's boards.
    expect(boardReadsPerWorkingDay(70, TODAY)).toBe(120 + 2 * 50);
  });

  it("never reads the board more often than it looks, however busy the week", () => {
    expect(boardReadsPerWorkingDay(10_000, TODAY)).toBe(1_200);
  });

  it("gives requests what the 80% leaves after the cron's share", () => {
    expect(REQUEST_READ_SHARE).toBeCloseTo(HEADROOM - CRON_READ_SHARE);
    expect(FREE_TIER.d1RowsReadPerDay * REQUEST_READ_SHARE).toBe(2_000_000);
  });

  it("leaves room for 158 visits in the board's week, nearly four times what reading it every minute left", () => {
    expect(consoleRunwayVisits(TODAY)).toBe(158);
    expect(consoleRunwayVisits(EVERY_MINUTE)).toBe(42);
  });

  it("lets a release's soak pass a board load of no more than those visits", () => {
    const load = BOARD_ROWS_READ_FIXED + BOARD_ROWS_READ_PER_VISIT * consoleRunwayVisits(TODAY);
    expect(ROUTE_ROWS_READ["/api/dispatch"]).toBe(load);
    expect(ROUTE_ROWS_READ["/api/tasks"]).toBe(TASKS_ROWS_READ_PER_LOOK);
  });

  it("still passes the requests' share before 2,000 clients, since each read of the board grows with its week", () => {
    const share = FREE_TIER.d1RowsReadPerDay * REQUEST_READ_SHARE - OTHER_REQUESTS_ROWS_READ_PER_DAY;
    expect(consoleRowsReadPerDay(VISITS_IN_WEEK_AT_2000_CLIENTS, TODAY)).toBeGreaterThan(share);
  });
});

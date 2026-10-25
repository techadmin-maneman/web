// The dispatch board. The board asks where a job would
// land before it offers anywhere to drop it; every move asks for a reason
// before anything is sent; the server refuses a clash, and a move made from a
// board that has gone stale, before it writes anything at all
// (docs/decisions/0034-clash-check.md, 0069-dispatch-under-concurrency.md).
// The board's part is to say which technician and which window it asked for,
// and what the client was actually told.
//
// The board is drawn for the mouse; everything the drag does is done here from
// the keyboard as well, and that path is what most of these tests walk.

import type { Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { BOARD, empty, fails, json, MOVED, PROPOSED, ROOM, VIKRAM, type Call } from "./fixtures.ts";
import {
  MOVE,
  READ_BOARD,
  READ_ROOM,
  MOVE_IT,
  ROHIT_BLOCK,
  moveTo,
  ROHIT_JOB,
  open,
  press,
  reason,
  sentTo,
} from "./dispatch-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const ASSIGN = "/api/dispatch/assign";

const PROPOSE = "/api/dispatch/propose";

const PROPOSE_IT: Call = `POST ${PROPOSE}`;

const WITHDRAW = `/api/dispatch/proposals/${PROPOSED.proposal_id}/withdraw` as const;

const WITHDRAW_IT: Call = `POST ${WITHDRAW}`;

const TOLD = `/api/dispatch/moves/${MOVED.move_id}/told` as const;

const READ_VERSION: Call = "GET /api/dispatch/version";

const ASSIGN_IT: Call = `POST ${ASSIGN}`;

const TOLD_IT: Call = `POST ${TOLD}`;

const VIKRAM_JOB = BOARD.technicians[0]?.days[0]?.blocks[1];

test("moves a job from a list, sends the board it was taken from, and says only what happened", async ({ page }) => {
  await open(page, { [MOVE_IT]: json(MOVED) });
  const sent = sentTo(page, MOVE);

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  // The list of technicians' days, then the sheet.
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");

  const picker = page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" });
  // The exact start the move takes, not the window alone.
  await expect(picker).toContainText("Fri 19 Sep, 9 am → Sat 20 Sep, 9 am");
  await expect(picker).toContainText("Rohit Malhotra gets the new time on WhatsApp. Their payment carries over.");
  // Nothing has gone out, and nothing can until a reason is chosen.
  expect(sent).toEqual([]);
  await expect(picker.getByRole("button", { name: opsCopy.dispatch.move.send })).toBeDisabled();

  await reason(page, "Client asked");
  await press(page, "Move and notify");

  // Queued is not sent: the notice says the message is on its way, and what happens if it fails.
  await expect(page.getByRole("status")).toHaveText("Moved. Rohit Malhotra gets the new time on WhatsApp.");
  expect(sent).toEqual([
    {
      appointment_id: ROHIT_JOB?.appointment_id,
      technician_id: BOARD.technicians[1]?.technician_id,
      date: "2025-09-20",
      starts_at: "2025-09-20T03:30:00.000Z",
      reason: "client_asked",
      expected_technician_id: BOARD.technicians[0]?.technician_id,
      expected_starts_at: ROHIT_JOB?.starts_at,
    },
  ]);
  // The board is read again without the loading state, and the keyboard goes back to the block.
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeFocused();
});

// A free visit, or one paid once the client is fitted, has no payment to carry over.
// ADR 0115: a client's visit goes to another day for ops' own reasons only once the client agrees.
test("asks the client to confirm a move to another day, sending it as a proposal the visit waits on", async ({
  page,
}) => {
  await open(page, { [PROPOSE_IT]: json(PROPOSED) });
  const sent = sentTo(page, PROPOSE);
  const moved = sentTo(page, MOVE);

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Zone rebalance");
  const picker = page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" });
  await expect(picker).toContainText("We’ll ask Rohit Malhotra on WhatsApp. It moves when they accept.");
  await press(page, "Ask Rohit Malhotra to confirm");

  await expect(page.getByRole("status")).toHaveText("Asked Rohit Malhotra on WhatsApp to confirm Sat 20 Sep, 9 am.");
  expect(sent).toEqual([
    expect.objectContaining({ date: "2025-09-20", starts_at: "2025-09-20T03:30:00.000Z", reason: "zone_rebalance" }),
  ]);
  expect(moved).toEqual([]);
});

test("shows a proposal waiting on the client where it would go and in the visit’s drawer, and takes it back", async ({
  page,
}) => {
  const waiting = structuredClone(BOARD);
  const block = waiting.technicians[0]?.days[0]?.blocks[0];
  if (block !== undefined) {
    block.proposal = {
      id: PROPOSED.proposal_id,
      date: "2025-09-20",
      window: "morning",
      hours: { start: "09:00", end: "12:00" },
      technician: { name: "Sandeep Yadav", initials: "SY" },
      technician_id: "66000000-0000-4000-8000-000000000002",
      starts_at: "2025-09-20T03:30:00.000Z",
      expires_at: "2025-09-20T03:30:00.000Z",
    };
  }
  const withdrawn = sentTo(page, WITHDRAW);
  await open(page, { [READ_BOARD]: json(waiting), [WITHDRAW_IT]: empty() });

  // A proposed move left no mark where it would go: a ghost stands on Sandeep's Saturday, and opens the visit.
  const sandeep = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /Sandeep Yadav/ }) });
  const ghost = sandeep.getByRole("button", { name: opsCopy.dispatch.board.ghost("Rohit M.", "Sat 20 Sep", "9 am") });
  await expect(ghost).toBeVisible();
  await ghost.click();
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  await page.keyboard.press("Escape");

  await press(page, ROHIT_BLOCK);
  const drawer = page.getByRole("dialog", { name: "Rohit Malhotra" });
  await expect(drawer).toContainText("Waiting for Rohit to confirm Sat 20 Sep, morning.");
  await press(page, "Withdraw");

  await expect(page.getByRole("status")).toHaveText("Withdrawn. Rohit M. stays as booked.");
  expect(withdrawn).toHaveLength(1);
});

test("says a payment carries over only where one was made", async ({ page }) => {
  const free = structuredClone(BOARD);
  const block = free.technicians[0]?.days[0]?.blocks[0];
  if (block !== undefined) block.badge = "free";
  await open(page, { [READ_BOARD]: json(free) });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");

  const picker = page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" });
  await expect(picker).toContainText("Rohit Malhotra gets the new time on WhatsApp.");
  await expect(picker).not.toContainText("carries over");
  // No technician's skills are recorded, so a move cannot claim one.
  await expect(picker.getByRole("radio")).toHaveCount(4);
});

// With a visit in hand, another week was never asked about, and said nowhere had room.
test("carries a job in hand to the next week, asks where it fits there, and moves it", async ({ page }) => {
  const NEXT = ["2025-09-26", "2025-09-27", "2025-09-28", "2025-09-29", "2025-09-30", "2025-10-01", "2025-10-02"];
  const nextWeek = {
    ...BOARD,
    from: NEXT[0],
    dates: NEXT,
    technicians: BOARD.technicians.map((row) => ({
      ...row,
      days: row.days.map((day, index) => ({ ...day, date: NEXT[index] ?? day.date, blocks: [] })),
    })),
    unassigned: [],
    utilisation: NEXT.map((date) => ({ date, percent: 0 })),
    leave: [],
  };
  const sandeep = BOARD.technicians[1]?.technician_id ?? "";
  const nextRoom = {
    ...ROOM,
    rooms: [
      {
        technician_id: sandeep,
        date: NEXT[0],
        windows: ["morning"],
        starts: [{ window: "morning", starts_at: "2025-09-26T03:30:00.000Z" }],
        km: null,
      },
    ],
  };
  const fromOf = (route: Route) => new URL(route.request().url()).searchParams.get("from");
  await open(page, {
    [READ_BOARD]: (route) => json(fromOf(route) === NEXT[0] ? nextWeek : BOARD)(route),
    [READ_ROOM]: (route) => json(fromOf(route) === NEXT[0] ? nextRoom : ROOM)(route),
    [MOVE_IT]: json(MOVED),
  });
  const sent = sentTo(page, MOVE);

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await page.getByRole("button", { name: opsCopy.dispatch.tools.next }).click();

  const list = page.getByLabel(opsCopy.dispatch.landing.list);
  await expect(list.getByRole("option")).toHaveText([
    opsCopy.dispatch.landing.listPrompt,
    "Sandeep Yadav · Fri 26 Sep · from 9 am",
  ]);
  await moveTo(page, "Sandeep Yadav", "Fri 26 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toContainText("Moved.");
  expect(sent).toEqual([
    {
      appointment_id: ROHIT_JOB?.appointment_id,
      technician_id: sandeep,
      date: NEXT[0],
      starts_at: "2025-09-26T03:30:00.000Z",
      reason: "client_asked",
      expected_technician_id: BOARD.technicians[0]?.technician_id,
      expected_starts_at: ROHIT_JOB?.starts_at,
    },
  ]);
});

test("says which technician and which time clashed, and keeps the job in hand", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "clash") });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await page.getByRole("radio", { name: "Client asked" }).check();
  await page.getByRole("button", { name: opsCopy.dispatch.move.send }).click();

  await expect(page.getByRole("alert")).toHaveText("Sandeep Yadav already has a job on Sat 20 Sep, 9 am.");
  // The job is still in hand, so another window can be chosen without starting again.
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// A free window with no room was refused as a clash that did not exist.
test("says a technician’s day has no room for the visit at a time, rather than naming a clash", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "does_not_fit") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText(
    "Service visit: no room in Sandeep Yadav’s day at 9 am on Sat 20 Sep.",
  );
});

// A move lands only at a start still ahead, and the server names a window already over.
test("says a window’s starts have all passed, and keeps the job in hand", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "window_passed") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText("Too late for Sat 20 Sep, 9 am. Choose a later time.");
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();
});

// Owner decision 16: a move onto a blacked-out day goes ahead with a warning and a typed reason.
test("asks why before a move onto a blacked-out day, and sends the reason with it", async ({ page }) => {
  await open(page, { [READ_ROOM]: json({ ...ROOM, blackouts: ["2025-09-20"] }), [MOVE_IT]: json(MOVED) });
  const sent = sentTo(page, MOVE);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");

  const picker = page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" });
  await expect(picker).toContainText("Sat 20 Sep is a closed day.");
  await reason(page, "Client asked");
  await expect(picker.getByRole("button", { name: opsCopy.dispatch.move.send })).toBeDisabled();
  await picker.getByLabel(opsCopy.dispatch.move.legend).fill("Their only free day before they travel");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toContainText("Moved. Rohit Malhotra gets the new time on WhatsApp.");
  expect(sent).toEqual([expect.objectContaining({ blackout_reason: "Their only free day before they travel" })]);
});

test("assigns a tray job through the assign route, with no technician expected", async ({ page }) => {
  await open(page, { [ASSIGN_IT]: json(MOVED) });
  const assigned = sentTo(page, ASSIGN);
  const moved = sentTo(page, MOVE);
  const tray = BOARD.unassigned[0];

  await page.getByRole("complementary", { name: opsCopy.dispatch.tray.title }).getByRole("button").first().click();
  await page
    .getByRole("dialog", { name: "Vikram Sethi" })
    .getByRole("button", { name: opsCopy.dispatch.drawer.assign })
    .click();
  await moveTo(page, "Imran Qureshi", "Sat 20 Sep");
  await page.getByRole("dialog").getByLabel(opsCopy.dispatch.move.start).selectOption({ label: "12 pm" });
  await page.getByRole("radio", { name: "Client asked" }).check();
  await page.getByRole("button", { name: opsCopy.dispatch.move.sendQuietly, exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Moved. Vikram Sethi gets the new time on WhatsApp.");
  expect(moved).toEqual([]);
  expect(assigned).toEqual([
    {
      appointment_id: tray?.appointment_id,
      technician_id: BOARD.technicians[0]?.technician_id,
      date: "2025-09-20",
      starts_at: "2025-09-20T06:30:00.000Z",
      reason: "client_asked",
      expected_technician_id: null,
      expected_starts_at: tray?.starts_at,
    },
  ]);
});

// "The client has been messaged" followed every move, while most clients had not agreed to WhatsApp.
test("asks ops to call a client who has not agreed to WhatsApp, and records the call", async ({ page }) => {
  const told = sentTo(page, TOLD);
  await open(page, {
    [MOVE_IT]: json({ ...MOVED, client_notice: "call" }),
    [TOLD_IT]: json({ told: true }),
  });

  await press(page, "Vikram S., Fri 19 Sep, 12 pm");
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  const picker = page.getByRole("dialog", { name: "Move Vikram Sethi to Sandeep Yadav" });
  await expect(picker).toContainText("Vikram Sethi isn’t on WhatsApp updates. Call +91 98100 00002 with the new time.");
  // No message goes, so the button promises none.
  await expect(picker.getByRole("button", { name: opsCopy.dispatch.move.send })).toHaveCount(0);
  await reason(page, "Client asked");
  await press(page, "Move");

  const status = page.getByRole("status");
  await expect(status).toContainText(
    "Moved. Vikram Sethi isn’t on WhatsApp updates: call +91 98100 00002 with the new time.",
  );
  await status.getByRole("button", { name: opsCopy.dispatch.landing.told }).click();
  await expect(page.getByRole("status")).toHaveText(`Recorded: ${VIKRAM.name} told by phone.`);
  expect(told).toHaveLength(1);
  expect(VIKRAM_JOB?.person?.whatsapp_visits).toBe(false);
});

test("tells ops a change of technician alone messages nobody", async ({ page }) => {
  await open(page, { [MOVE_IT]: json({ ...MOVED, client_notice: "unchanged" }) });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Fri 19 Sep");

  const picker = page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" });
  await expect(picker).toContainText("Rohit Malhotra keeps the same time. No message sent.");
  await reason(page, "Zone rebalance");
  await press(page, "Move");
  await expect(page.getByRole("status")).toHaveText("Rohit Malhotra is now with Sandeep Yadav. Same time.");
});

// Escape during "Moving" let the same job be moved twice.
test("lets go of nothing while a move is being sent, so it cannot be sent twice", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = sentTo(page, MOVE);
  await open(page, {
    [MOVE_IT]: async (route: Route) => {
      await held;
      await json(MOVED)(route);
    },
  });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");
  await expect(page.getByRole("button", { name: opsCopy.dispatch.move.sending })).toBeDisabled();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Move Rohit Malhotra to Sandeep Yadav" })).toBeVisible();
  await expect(page.getByRole("button", { name: opsCopy.dispatch.move.cancel })).toBeDisabled();

  release();
  await expect(page.getByRole("status")).toContainText("Moved. Rohit Malhotra gets the new time on WhatsApp.");
  expect(sent).toHaveLength(1);
});

// Two ops users overwrote each other, and the board never read itself again.
test("refuses a move made from a stale board, and says where the job is now", async ({ page }) => {
  const movedByAnother = structuredClone(BOARD);
  const [imran, , arjun] = movedByAnother.technicians;
  const rohit = imran?.days[0]?.blocks.shift();
  if (rohit !== undefined) arjun?.days[1]?.blocks.push({ ...rohit, window: "evening" });
  let reads = 0;
  await open(page, {
    [READ_BOARD]: (route: Route) => {
      reads += 1;
      return json(reads === 1 ? BOARD : movedByAnother)(route);
    },
    [MOVE_IT]: fails(409, "superseded"),
  });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move visit");
  await moveTo(page, "Sandeep Yadav", "Sat 20 Sep");
  await reason(page, "Client asked");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText(
    "Rohit Malhotra was just moved by someone else. It’s now with Arjun Negi, Sat 20 Sep, 9 am.",
  );
  await expect(page.getByText("Moving Rohit M.")).toBeHidden();
});

// The board read itself in full on every focus and every minute; it now asks for its version first.
test("reads the board again when the tab comes back to a board that has changed, without the loading state", async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  await open(page, {
    [READ_BOARD]: (route: Route) => {
      reads += 1;
      return json(BOARD)(route);
    },
    [READ_VERSION]: json({ version: BOARD.version + 1 }),
  });
  expect(reads).toBe(1);

  // A look within half a minute of the last is skipped.
  await page.clock.fastForward("00:31");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Loading")).toHaveCount(0);
});

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
import { BOARD, fails, json, MOVED, ROOM, VIKRAM, type Call } from "./fixtures.ts";
import {
  MOVE,
  READ_BOARD,
  READ_ROOM,
  MOVE_IT,
  ROHIT_BLOCK,
  TO_SANDEEP,
  ROHIT_JOB,
  open,
  press,
  reason,
  sentTo,
} from "./dispatch-fixtures.ts";

const ASSIGN = "/api/dispatch/assign";

const TOLD = `/api/dispatch/moves/${MOVED.move_id}/told` as const;

const READ_VERSION: Call = "GET /api/dispatch/version";

const ASSIGN_IT: Call = `POST ${ASSIGN}`;

const TOLD_IT: Call = `POST ${TOLD}`;

const VIKRAM_JOB = BOARD.technicians[0]?.days[0]?.blocks[1];

test("moves a job from a list, sends the board it was taken from, and says only what happened", async ({ page }) => {
  await open(page, { [MOVE_IT]: json(MOVED) });
  const sent = sentTo(page, MOVE);

  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  // The keyboard's way: the list of destinations, then the same sheet.
  await page.getByLabel("Or choose where from a list").selectOption({ label: "Sandeep Yadav · Sat 20 Sep · morning" });
  await press(page, "Choose");

  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  // The exact start the move takes, not the window alone.
  await expect(picker).toContainText("Fri 19 Sep, 9 am → Sat 20 Sep, 9 am");
  await expect(picker).toContainText(
    "Rohit M. is messaged on WhatsApp with the new window. Their payment carries over.",
  );
  // Nothing has gone out, and nothing can until a reason is chosen.
  expect(sent).toEqual([]);
  await expect(picker.getByRole("button", { name: "Move and notify" })).toBeDisabled();

  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");

  // Queued is not sent: the notice says the message is on its way, and what happens if it fails.
  await expect(page.getByRole("status")).toHaveText(
    "Moved. We're sending Rohit M. the new window on WhatsApp; if it fails, a call task appears.",
  );
  expect(sent).toEqual([
    {
      appointment_id: ROHIT_JOB?.appointment_id,
      technician_id: BOARD.technicians[1]?.technician_id,
      date: "2025-09-20",
      window: "morning",
      reason: "zone_rebalance",
      expected_technician_id: BOARD.technicians[0]?.technician_id,
      expected_starts_at: ROHIT_JOB?.starts_at,
    },
  ]);
  // The board is read again without the loading state, and the keyboard goes back to the block.
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeFocused();
});

// A free visit, or one paid once the client is fitted, has no payment to carry over.
test("says a payment carries over only where one was made", async ({ page }) => {
  const free = structuredClone(BOARD);
  const block = free.technicians[0]?.days[0]?.blocks[0];
  if (block !== undefined) block.badge = "free";
  await open(page, { [READ_BOARD]: json(free) });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await page.getByLabel("Or choose where from a list").selectOption({ label: "Sandeep Yadav · Sat 20 Sep · morning" });
  await press(page, "Choose");

  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await expect(picker).toContainText("Rohit M. is messaged on WhatsApp with the new window.");
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
  await press(page, "Move this visit");
  await page.getByRole("button", { name: "Next week" }).click();

  const list = page.getByLabel("Or choose where from a list");
  await expect(list.getByRole("option")).toHaveText([
    "A technician, day and window",
    "Sandeep Yadav · Fri 26 Sep · morning",
  ]);
  await list.selectOption({ label: "Sandeep Yadav · Fri 26 Sep · morning" });
  await press(page, "Choose");
  await reason(page, "Client asked to move it");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toContainText("Moved.");
  expect(sent).toEqual([
    {
      appointment_id: ROHIT_JOB?.appointment_id,
      technician_id: sandeep,
      date: NEXT[0],
      window: "morning",
      reason: "client_asked",
      expected_technician_id: BOARD.technicians[0]?.technician_id,
      expected_starts_at: ROHIT_JOB?.starts_at,
    },
  ]);
});

test("drags a block onto a window, which asks for the same reason", async ({ page }) => {
  await open(page, { [MOVE_IT]: json(MOVED) });

  // The windows are offered once the drag has begun, so the drop is walked by hand.
  const carried = await page.evaluateHandle(() => new DataTransfer());
  await page.getByRole("button", { name: ROHIT_BLOCK }).dispatchEvent("dragstart", { dataTransfer: carried });
  const target = page.getByRole("button", { name: TO_SANDEEP });
  await target.dispatchEvent("dragover", { dataTransfer: carried });
  await target.dispatchEvent("drop", { dataTransfer: carried });

  await expect(page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" })).toBeVisible();
});

test("says which technician and which window clashed, and keeps the job in hand", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "clash") });

  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await page.getByRole("radio", { name: "Technician unavailable" }).check();
  await page.getByRole("button", { name: "Move and notify" }).click();

  await expect(page.getByRole("alert")).toHaveText(
    "Sandeep Yadav already holds a job on Sat 20 Sep, morning. Nothing was moved.",
  );
  // The job is still in hand, so another window can be chosen without starting again.
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// A free window with no room was refused as a clash that did not exist.
test("says a window has no room for the visit, rather than naming a clash", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "does_not_fit") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Client asked to move it");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText(
    "Service visit has no room in Sandeep Yadav's morning on Sat 20 Sep: its time is taken, or it would run past the day's end. Nothing was moved.",
  );
});

// A move lands only at a start still ahead, and the server names a window already over.
test("says a window's starts have all passed, and keeps the job in hand", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "window_passed") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Client asked to move it");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText(
    "Too late for Sat 20 Sep, morning. Choose a later window. Nothing was moved.",
  );
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();
});

// Owner decision 16: a move onto a blacked-out day goes ahead with a warning and a typed reason.
test("asks why before a move onto a blacked-out day, and sends the reason with it", async ({ page }) => {
  await open(page, { [READ_ROOM]: json({ ...ROOM, blackouts: ["2025-09-20"] }), [MOVE_IT]: json(MOVED) });
  const sent = sentTo(page, MOVE);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);

  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await expect(picker).toContainText("Sat 20 Sep is blacked out, so nothing is booked that day.");
  await reason(page, "Client asked to move it");
  await expect(picker.getByRole("button", { name: "Move and notify" })).toBeDisabled();
  await picker.getByLabel("Why it goes ahead that day").fill("His only free day before he travels");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toContainText("Moved. We're sending Rohit M. the new window on WhatsApp;");
  expect(sent).toEqual([expect.objectContaining({ blackout_reason: "His only free day before he travels" })]);
});

test("assigns a tray job through the assign route, with no technician expected", async ({ page }) => {
  await open(page, { [ASSIGN_IT]: json(MOVED) });
  const assigned = sentTo(page, ASSIGN);
  const moved = sentTo(page, MOVE);
  const tray = BOARD.unassigned[0];

  await page.getByRole("complementary", { name: "Unassigned" }).getByRole("button").first().click();
  await page
    .getByRole("dialog", { name: "Vikram Sethi" })
    .getByRole("button", { name: "Assign to a technician" })
    .click();
  await page.getByRole("button", { name: "Move Vikram S. to Imran Qureshi, Sat 20 Sep, afternoon" }).click();
  await page.getByRole("radio", { name: "Client asked to move it" }).check();
  await page.getByRole("button", { name: "Move", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Moved. We're sending Vikram S. the new window on WhatsApp;");
  expect(moved).toEqual([]);
  expect(assigned).toEqual([
    {
      appointment_id: tray?.appointment_id,
      technician_id: BOARD.technicians[0]?.technician_id,
      date: "2025-09-20",
      window: "afternoon",
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

  await press(page, "Vikram S., Fri 19 Sep, afternoon");
  await press(page, "Move this visit");
  await press(page, "Move Vikram S. to Sandeep Yadav, Sat 20 Sep, morning");
  const picker = page.getByRole("dialog", { name: "Move Vikram S. to Sandeep Yadav" });
  await expect(picker).toContainText(
    "Vikram Sethi has not agreed to WhatsApp — call +91 98100 00002 with the new window.",
  );
  // No message goes, so the button promises none.
  await expect(picker.getByRole("button", { name: "Move and notify" })).toHaveCount(0);
  await reason(page, "Client asked to move it");
  await press(page, "Move");

  const status = page.getByRole("status");
  await expect(status).toContainText(
    "Vikram S. moved. Vikram Sethi has not agreed to WhatsApp: call +91 98100 00002 with the new window.",
  );
  await status.getByRole("button", { name: "Told by phone" }).click();
  await expect(page.getByRole("status")).toHaveText(`Recorded that ${VIKRAM.name} was told by phone.`);
  expect(told).toHaveLength(1);
  expect(VIKRAM_JOB?.person?.whatsapp_visits).toBe(false);
});

test("tells ops a change of technician alone messages nobody", async ({ page }) => {
  await open(page, { [MOVE_IT]: json({ ...MOVED, client_notice: "unchanged" }) });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, "Move Rohit M. to Sandeep Yadav, Fri 19 Sep, morning");

  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await expect(picker).toContainText(
    "Only the technician changes. Rohit M. keeps the same window, so nobody is messaged.",
  );
  await reason(page, "Zone rebalance");
  await press(page, "Move");
  await expect(page.getByRole("status")).toHaveText(
    "Rohit M. is now with Sandeep Yadav. The window is the same, so nobody was messaged.",
  );
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
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");
  await expect(page.getByRole("button", { name: "Moving" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();

  release();
  await expect(page.getByRole("status")).toContainText("Moved. We're sending Rohit M. the new window on WhatsApp;");
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
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText(
    "Someone else moved Rohit M. while you were choosing. It is now with Arjun Negi, Sat 20 Sep, evening. Nothing was moved.",
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

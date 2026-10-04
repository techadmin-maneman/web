// The dispatch board (boards A1, A2 and A3). The board asks where a job would
// land before it offers anywhere to drop it; every move asks for a reason
// before anything is sent; the server refuses a clash, and a move made from a
// board that has gone stale, before it writes anything at all
// (docs/decisions/0034-clash-check.md, 0069-dispatch-under-concurrency.md).
// The board's part is to say which technician and which window it asked for,
// and what the client was actually told.
//
// The board is drawn for the mouse; everything the drag does is done here from
// the keyboard as well, and that path is what most of these tests walk.

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, BOARD, fails, json, MOVED, ROHIT, ROOM, VIKRAM, type Answers, type Call } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BOARD_PATH = "/api/dispatch";
const MOVE = "/api/dispatch/move";
const ASSIGN = "/api/dispatch/assign";
const TOLD = `/api/dispatch/moves/${MOVED.move_id}/told` as const;
const READ_BOARD: Call = `GET ${BOARD_PATH}`;
const READ_ROOM: Call = "GET /api/dispatch/room";
const MOVE_IT: Call = `POST ${MOVE}`;
const ASSIGN_IT: Call = `POST ${ASSIGN}`;
const TOLD_IT: Call = `POST ${TOLD}`;

/** The block the design moves, and where it moves it to. */
const ROHIT_BLOCK = "Rohit M., Fri 19 Sep, morning";
const TO_SANDEEP = "Move Rohit M. to Sandeep Yadav, Sat 20 Sep, morning";
const ROHIT_JOB = BOARD.technicians[0]?.days[0]?.blocks[0];
const VIKRAM_JOB = BOARD.technicians[0]?.days[0]?.blocks[1];

async function open(page: Page, writes: Answers = {}): Promise<void> {
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM), ...writes });
  await page.goto("/dispatch");
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeVisible();
}

/** Presses a control the way a keyboard does: focus it, then Enter. */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
}

/** Picks a reason from the keyboard, as the move's panel asks before anything is sent. */
async function reason(page: Page, label: string): Promise<void> {
  await page.getByRole("radio", { name: label }).focus();
  await page.keyboard.press("Space");
}

/** Every body the console sent to a path, in order. */
function sentTo(page: Page, path: string): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path && request.method() === "POST") sent.push(request.postDataJSON());
  });
  return sent;
}

test("draws the week, every technician and the jobs on their days", async ({ page }) => {
  await open(page);
  await expect(page.getByText("19 to 25 Sep")).toBeVisible();

  const grid = page.getByRole("table");
  await expect(grid.getByRole("columnheader")).toHaveText([
    "Fri 1964%",
    "Sat 2092%",
    "Sun 2188%",
    "Mon 2258%",
    "Tue 2364%",
    "Wed 2461%",
    "Thu 2567%",
  ]);
  await expect(grid.getByRole("rowheader")).toHaveText([
    "Imran QureshiSec 40–65",
    "Sandeep YadavSec 1–39",
    "Arjun NegiDLF 1–5",
    "Faizan AliSohna Rd",
  ]);
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toContainText("Sec 65 · service");
  await expect(page.getByRole("button", { name: "Sanjay B., Sat 20 Sep, morning" })).toContainText(
    "Sec 43 · first fit",
  );
});

// Open point 67, ruled by the owner on 27 September 2026: "block heights follow their slots, about 42, 63 and 84 px".
test("draws each job as tall as the slots it takes, so its size reads from its height", async ({ page }) => {
  await open(page);
  const heightOf = async (name: string) => (await page.getByRole("button", { name }).boundingBox())?.height ?? 0;

  const oneSlot = await heightOf(ROHIT_BLOCK);
  const slotAndAHalf = await heightOf("Kunal M., Tue 23 Sep, afternoon");
  const twoSlots = await heightOf("Sanjay B., Sat 20 Sep, morning");

  expect(Math.abs(oneSlot - 42)).toBeLessThanOrEqual(1);
  expect(Math.abs(slotAndAHalf - 63)).toBeLessThanOrEqual(1);
  expect(Math.abs(twoSlots - 84)).toBeLessThanOrEqual(1);
});

test("marks the days a technician is away, and still shows the jobs already on them", async ({ page }) => {
  await open(page);
  // Faizan is away on the Sunday and the Monday, and holds a job on each.
  await expect(page.getByText("Faizan Ali is away on Sun 21 Sep")).toBeAttached();
  await expect(page.getByText("Faizan Ali is away on Mon 22 Sep")).toBeAttached();
  await expect(page.getByRole("button", { name: "Nitin R., Sun 21 Sep, afternoon" })).toBeVisible();
  await expect(page.getByText("Faizan Ali is away on Tue 23 Sep")).toHaveCount(0);
  await expect(page.getByText("Leave is recorded on the Technicians screen")).toBeVisible();
  // A11Y-22 of the audit, 24 September 2026: the mark was named by an aria-label on a plain span, which ARIA forbids.
  await expect(page.locator("main span[aria-label]")).toHaveCount(0);
});

// FEO-10 and REQ-S9-02: "Drop it on a cell with room", with "a hint that shows its slot size".
test("says how much of a day the job takes, and offers only the windows it would land in", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");

  await expect(page.getByText("Moving Rohit M., service visit, 1 slot.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Move Rohit M. to Arjun Negi, Sun 21 Sep, morning" })).toBeVisible();
  // Faizan is away on the Sunday; Sandeep's Saturday afternoon is full.
  await expect(page.getByRole("button", { name: /Move Rohit M\. to Faizan Ali, Sun 21 Sep/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move Rohit M\. to Faizan Ali, Tue 23 Sep/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Move Rohit M. to Sandeep Yadav, Sat 20 Sep, afternoon" })).toHaveCount(
    0,
  );
  // Arjun's Tuesday has no room at all, and says so.
  const arjun = page.getByRole("row", { name: /Arjun Negi/ });
  await expect(arjun.getByRole("cell").nth(4)).toHaveText("No room");
});

test("names leave when the server refuses a move onto a day off", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "on_leave") });
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");

  await expect(page.getByRole("alert")).toHaveText("Sandeep Yadav is away on Sat 20 Sep. Nothing was moved.");
});

// FEO-08 and OPS-05: the tray paired the offered day with the asked window, and named no client.
test("lists the tray's jobs with their client, the window asked beside the one offered, and who invited them", async ({
  page,
}) => {
  await open(page);
  const tray = page.getByRole("complementary", { name: "Unassigned" });
  const first = tray.getByRole("listitem").first();
  await expect(first).toContainText("Vikram Sethi");
  await expect(first).toContainText("First fit");
  // The client asked for a morning, on no recorded day, and is being offered a Saturday evening.
  await expect(first).toContainText("Asked · morning");
  await expect(first).not.toContainText("Asked · Sat");
  await expect(first).toContainText("Offered · Sat, evening");
  await expect(first).toContainText("Referred by Rohit Malhotra");
  // A visit with no Request behind it says so, rather than repeating the offered window.
  const last = tray.getByRole("listitem").last();
  await expect(last).toContainText("Asked · not recorded");
  await expect(last).toContainText("Offered · Sun, afternoon");
  await expect(tray.getByText("Asked is what the client picked on their booking")).toBeVisible();
});

// OPS-05 and OPS-12: board A3's badge, WhatsApp {client} and Open client.
test("opens a block's drawer with the client, the badge, and both ways to reach him", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);

  const drawer = page.getByRole("dialog", { name: "Rohit Malhotra" });
  await expect(drawer).toContainText("Fri 19 Sep · 9 am to 12 · Imran Qureshi");
  await expect(drawer).toContainText("Prepaid");
  await expect(drawer).toContainText("Service visit · 1 slot");
  await expect(drawer).toContainText("Sec 65 · 122018");
  await expect(drawer).toContainText("Scheduled");
  await expect(drawer.getByRole("link", { name: "WhatsApp Rohit" })).toHaveAttribute(
    "href",
    "https://wa.me/919810000001",
  );
  await expect(drawer.getByRole("link", { name: "Open client" })).toHaveAttribute("href", `/clients/${ROHIT.id}`);

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeFocused();
});

// FEO-13: the drawer and the picker are modal; nothing behind them takes the keyboard. Past the
// panel's last control the browser's own come next (the page's body holds focus), then the panel's first.
test("keeps the keyboard off the board behind an open panel", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Tab");
    const behind = await page.evaluate(() => {
      const active = document.activeElement;
      const panel = document.querySelector("dialog[open]");
      return active !== null && active !== document.body && panel?.contains(active) !== true;
    });
    expect(behind, `Tab ${String(step + 1)} reached the board behind the drawer`).toBe(false);
  }
});

test("moves a job from a list, sends the board it was taken from, and says only what happened", async ({ page }) => {
  await open(page, { [MOVE_IT]: json(MOVED) });
  const sent = sentTo(page, MOVE);

  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  // The keyboard's way: the list of destinations, then the same sheet.
  await page.getByLabel("Or choose where from a list").selectOption({ label: "Sandeep Yadav · Sat 20 Sep · morning" });
  await press(page, "Choose");

  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await expect(picker).toContainText("Fri 19 Sep, morning → Sat 20 Sep, morning");
  await expect(picker).toContainText("Rohit M. is messaged on WhatsApp with the new window.");
  // Nothing has gone out, and nothing can until a reason is chosen.
  expect(sent).toEqual([]);
  await expect(picker.getByRole("button", { name: "Move and notify" })).toBeDisabled();

  await reason(page, "Zone rebalance");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toHaveText("Rohit M. moved. The client was sent the new window on WhatsApp.");
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

// OPS-06: a free window with no room was refused as a clash that did not exist.
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

test("assigns a tray job through the assign route, with no technician expected", async ({ page }) => {
  await open(page, { [ASSIGN_IT]: json(MOVED) });
  const assigned = sentTo(page, ASSIGN);
  const moved = sentTo(page, MOVE);
  const tray = BOARD.unassigned[0];

  await page.getByRole("complementary", { name: "Unassigned" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Move Vikram S. to Imran Qureshi, Sat 20 Sep, afternoon" }).click();
  await page.getByRole("radio", { name: "Client asked to move it" }).check();
  await page.getByRole("button", { name: "Move", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Vikram S. moved.");
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

// OPS-01: "The client has been messaged" followed every move, while most clients had not agreed to WhatsApp.
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

// FEO-04: Escape during "Moving" let the same job be moved twice.
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
  await expect(page.getByRole("status")).toContainText("Rohit M. moved.");
  expect(sent).toHaveLength(1);
});

// FEO-05: two ops users overwrote each other, and the board never read itself again.
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

test("reads the board again when the tab comes back, without the loading state", async ({ page }) => {
  let reads = 0;
  await open(page, {
    [READ_BOARD]: (route: Route) => {
      reads += 1;
      return json(BOARD)(route);
    },
  });
  expect(reads).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(2);
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Loading")).toHaveCount(0);
});

// FEO-09: the brief's "city and week picker"; the route took both, and the board sent neither.
test("moves between weeks and cities, asking the route for each", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === BOARD_PATH) asked.push(url.search);
  });
  await open(page);

  await page.getByRole("button", { name: "Next week" }).click();
  await expect.poll(() => asked.at(-1)).toBe("?from=2025-09-26");
  await page.getByLabel("City", { exact: true }).selectOption("Delhi");
  await expect.poll(() => asked.at(-1)).toBe("?from=2025-09-26&city=Delhi");
  await page.getByRole("button", { name: "This week" }).click();
  await expect.poll(() => asked.at(-1)).toBe("?city=Delhi");
});

// A technician's page shows his days by linking here with the week and his name.
test("opens on the week and the search a link asks for", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === BOARD_PATH) asked.push(url.search);
  });
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM) });
  await page.goto("/dispatch?from=2025-09-19&find=Sohna");

  await expect(page.getByLabel("Find a technician, zone or client")).toHaveValue("Sohna");
  await expect(page.getByRole("rowheader")).toHaveText(["Faizan AliSohna Rd"]);
  await expect.poll(() => asked[0]).toBe("?from=2025-09-19");
});

// OPS-10: 168 technicians made a board 15,000 px tall whose day headers scrolled away, with no way to find a row.
test("keeps its header row and technicians' column in place, and finds a row by name, zone or client", async ({
  page,
}) => {
  await open(page);
  const position = (element: HTMLElement) => getComputedStyle(element).position;
  expect(await page.getByRole("columnheader").first().evaluate(position)).toBe("sticky");
  expect(await page.getByRole("rowheader").first().evaluate(position)).toBe("sticky");

  const find = page.getByLabel("Find a technician, zone or client");
  await find.fill("Sohna");
  await expect(page.getByRole("rowheader")).toHaveText(["Faizan AliSohna Rd"]);
  await find.fill("kabir");
  await expect(page.getByRole("rowheader")).toHaveText(["Arjun NegiDLF 1–5"]);
  await find.fill("nobody");
  await expect(page.getByText("No technician, zone or client this week matches “nobody”.")).toBeVisible();
});

// VIS-22: at 1280 wide and 200% zoom the days shrank to 15 px and the navigation ran off the page.
test("keeps every day readable, and the navigation in reach, at 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await open(page);
  for (const head of await page.getByRole("columnheader").all()) {
    expect((await head.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(96);
  }
  const settings = page.getByRole("link", { name: "Settings" });
  await settings.scrollIntoViewIfNeeded();
  await expect(settings).toBeInViewport();
});

test("meets WCAG 2.2 AA on the board, the drawer, a job in hand, the picker and a refusal", async ({ page }) => {
  await open(page, { [MOVE_IT]: fails(409, "clash") });
  const board = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(board.violations.map((violation) => violation.id)).toEqual([]);

  await press(page, ROHIT_BLOCK);
  await expect(page.getByRole("dialog", { name: "Rohit Malhotra" })).toBeVisible();
  const drawer = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(drawer.violations.map((violation) => violation.id)).toEqual([]);

  await press(page, "Move this visit");
  await expect(page.getByLabel("Or choose where from a list")).toBeVisible();
  const inHand = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(inHand.violations.map((violation) => violation.id)).toEqual([]);

  await press(page, TO_SANDEEP);
  const picker = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(picker.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("radio", { name: "Running over on an earlier job" }).check();
  await page.getByRole("button", { name: "Move and notify" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const refused = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(refused.violations.map((violation) => violation.id)).toEqual([]);
});

test("Escape lets go of the picker, then of the move itself", async ({ page }) => {
  await open(page);
  await press(page, ROHIT_BLOCK);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Moving Rohit M.")).toBeHidden();
});

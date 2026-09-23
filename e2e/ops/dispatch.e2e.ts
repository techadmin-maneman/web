// The dispatch board (boards A1, A2 and A3). Every move asks for a reason
// before anything is sent, and the server refuses a clash before it writes
// anything at all (docs/decisions/0034-clash-check.md), so the board's part is
// to say which technician and which window it asked for.
//
// The board is drawn for the mouse; everything the drag does is done here from
// the keyboard as well, and that path is what these tests walk.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, BOARD, fails, json, MOVED } from "./fixtures.ts";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MOVE = "/api/dispatch/move";
const ASSIGN = "/api/dispatch/assign";

/** The block the design moves, and where it moves it to. */
const ROHIT = "Rohit M., Fri 19 Sep, morning";
const TO_SANDEEP = "Move Rohit M. to Sandeep Yadav, Sat 20 Sep, morning";

async function open(page: Page, writes: Record<string, ReturnType<typeof json>> = {}): Promise<void> {
  await answer(page, { "/api/dispatch": json(BOARD), ...writes });
  await page.goto("/dispatch");
  await expect(page.getByRole("heading", { level: 1, name: "Dispatch" })).toBeVisible();
}

/** Presses a control the way a keyboard does: focus it, then Enter. */
async function press(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
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
  await expect(page.getByRole("button", { name: ROHIT })).toContainText("Sec 65 · service");
  await expect(page.getByRole("button", { name: "Sanjay B., Sat 20 Sep, morning" })).toContainText(
    "Sec 43 · first fit",
  );
});

test("shows no leave anywhere, and says why", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Leave")).toHaveCount(1);
  await expect(page.getByText("FSM answers about availability 48 hours ahead")).toBeVisible();
});

test("lists the unassigned tray, and says why asked and offered never differ", async ({ page }) => {
  await open(page);
  const tray = page.getByRole("complementary", { name: "Unassigned" });
  await expect(tray.getByRole("listitem").first()).toContainText("First fit");
  await expect(tray.getByRole("listitem").first()).toContainText("Asked · Sat, morning");
  await expect(tray.getByRole("listitem").first()).toContainText("Offered · Sat, morning");
  await expect(tray.getByText("FSM holds one time on a visit")).toBeVisible();
});

test("opens a block's drawer with what the board knows of the visit", async ({ page }) => {
  await open(page);
  await press(page, ROHIT);

  const drawer = page.getByRole("dialog", { name: "Rohit M." });
  await expect(drawer).toContainText("Fri 19 Sep · 9 am to 12 · Imran Qureshi");
  await expect(drawer).toContainText("Service visit · 1 slot");
  await expect(drawer).toContainText("Sec 65");
  await expect(drawer).toContainText("Scheduled");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("moves a job from the keyboard, and sends nothing until a reason is chosen", async ({ page }) => {
  const sent: unknown[] = [];
  await open(page, { [MOVE]: json(MOVED) });
  page.on("request", (request) => {
    if (request.url().includes(MOVE)) sent.push(request.postDataJSON());
  });

  await press(page, ROHIT);
  await press(page, "Move this visit");
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();

  await press(page, TO_SANDEEP);
  const picker = page.getByRole("dialog", { name: "Move Rohit M. to Sandeep Yadav" });
  await expect(picker).toContainText("Fri 19 Sep, morning → Sat 20 Sep, morning");
  await expect(picker).toContainText("Rohit M. is messaged on WhatsApp with the new window.");
  // Nothing has gone out, and nothing can until a reason is chosen.
  expect(sent).toEqual([]);
  await expect(picker.getByRole("button", { name: "Move and notify" })).toBeDisabled();

  await picker.getByRole("radio", { name: "Zone rebalance" }).focus();
  await page.keyboard.press("Space");
  await press(page, "Move and notify");

  await expect(page.getByRole("status")).toHaveText("Rohit M. moved. The client has been messaged.");
  expect(sent).toEqual([
    {
      appointment_id: BOARD.technicians[0]?.days[0]?.blocks[0]?.appointment_id,
      technician_id: BOARD.technicians[1]?.technician_id,
      date: "2025-09-20",
      window: "morning",
      reason: "zone_rebalance",
    },
  ]);
});

test("says which technician and which window clashed, and moves nothing", async ({ page }) => {
  await open(page, { [MOVE]: fails(409, "clash") });

  await press(page, ROHIT);
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

test("assigns a tray job through the assign route, not the move one", async ({ page }) => {
  const sent: { path: string; body: unknown }[] = [];
  await open(page, { [ASSIGN]: json(MOVED) });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === ASSIGN || path === MOVE) sent.push({ path, body: request.postDataJSON() });
  });

  await page.getByRole("complementary", { name: "Unassigned" }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Move First fit · Sec 43 to Imran Qureshi, Sat 20 Sep, afternoon" }).click();
  await page.getByRole("radio", { name: "Client asked to move it" }).check();
  await page.getByRole("button", { name: "Move and notify" }).click();

  await expect(page.getByRole("status")).toContainText("First fit · Sec 43 moved.");
  expect(sent).toEqual([
    {
      path: ASSIGN,
      body: {
        appointment_id: "78000000-0000-4000-8000-000000000001",
        technician_id: BOARD.technicians[0]?.technician_id,
        date: "2025-09-20",
        window: "afternoon",
        reason: "client_asked",
      },
    },
  ]);
});

test("Escape lets go of the picker, then of the move itself", async ({ page }) => {
  await open(page);
  await press(page, ROHIT);
  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Moving Rohit M.")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText("Moving Rohit M.")).toBeHidden();
});

test("meets WCAG 2.2 AA on the board, on the drawer, and with a move refused", async ({ page }) => {
  await open(page, { [MOVE]: fails(409, "clash") });
  const board = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(board.violations.map((violation) => violation.id)).toEqual([]);

  await press(page, ROHIT);
  await expect(page.getByRole("dialog", { name: "Rohit M." })).toBeVisible();
  const drawer = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(drawer.violations.map((violation) => violation.id)).toEqual([]);

  await press(page, "Move this visit");
  await press(page, TO_SANDEEP);
  const picker = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(picker.violations.map((violation) => violation.id)).toEqual([]);

  await page.getByRole("radio", { name: "Running over on an earlier job" }).check();
  await page.getByRole("button", { name: "Move and notify" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const refused = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(refused.violations.map((violation) => violation.id)).toEqual([]);
});

// What the dispatch board browser tests share (dispatch*.e2e.ts): the calls the board makes, Rohit's job and its block,
// the board opened, a key pressed, a reason given, and where a move was sent.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { answer, BOARD, json, ROOM, type Answers, type Call } from "./fixtures.ts";
import { dispatch } from "../../apps/ops/src/content.ts";

export const BOARD_PATH = "/api/dispatch";

export const MOVE = "/api/dispatch/move";

export const READ_BOARD = `GET ${BOARD_PATH}` as const satisfies Call;

export const READ_ROOM = "GET /api/dispatch/room" as const satisfies Call;

export const MOVE_IT = `POST ${MOVE}` as const satisfies Call;

/** The block the design moves. */
export const ROHIT_BLOCK = "Rohit M., Fri 19 Sep, 9 am";

export const ROHIT_JOB = BOARD.technicians[0]?.days[0]?.blocks[0];

export async function open(page: Page, writes: Answers = {}): Promise<void> {
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM), ...writes });
  await page.goto("/dispatch");
  await expect(page.getByRole("heading", { level: 1, name: dispatch.title })).toBeVisible();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toBeVisible();
}

/** Presses a control the way a keyboard does: focus it, then Enter. */
export async function press(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).focus();
  await page.keyboard.press("Enter");
}

/** Picks a reason from the keyboard, as the move's panel asks before anything is sent. */
export async function reason(page: Page, label: string): Promise<void> {
  await page.getByRole("radio", { name: label }).focus();
  await page.keyboard.press("Space");
}

/** The technicians' days the move list offers the job in hand, each from its first free start. */
export const listed = (page: Page) => page.getByLabel(dispatch.landing.list).locator("option:not([disabled])");

/** Puts the job in hand on a technician's day from the move list, as ops do: the day, then Choose. */
export async function moveTo(page: Page, technician: string, day: string): Promise<void> {
  const list = page.getByLabel(dispatch.landing.list);
  const labels = await listed(page).allInnerTexts();
  const label = labels.find((each) => each.startsWith(`${technician} · ${day} · `));
  if (label === undefined) throw new Error(`no ${technician} on ${day} in the move list: ${labels.join("; ")}`);
  await list.selectOption({ label });
  await press(page, dispatch.landing.listGo);
}

/** Every body the console sent to a path, in order. */
export function sentTo(page: Page, path: string): unknown[] {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === path && request.method() === "POST") sent.push(request.postDataJSON());
  });
  return sent;
}

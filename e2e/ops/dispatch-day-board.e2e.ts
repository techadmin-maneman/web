// The board's day along the hours: booking and moving were done blind, from a week of cards and a list of days, with no
// picture of who was free when. The board now opens on the day: each technician's visits across the hours, a visit
// opening its drawer, and, with a job in hand, each start it could take there a button that places it.

import { expect, test } from "../support.ts";
import { answer, BOARD, json, ROOM } from "./fixtures.ts";
import { press, READ_BOARD, READ_ROOM } from "./dispatch-fixtures.ts";
import { axeViolations } from "../a11y.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const copy = opsCopy.dispatch;

test("opens on the day, a row of hours a technician, and places a job in hand at the start chosen", async ({
  page,
}) => {
  await answer(page, { [READ_BOARD]: json(BOARD), [READ_ROOM]: json(ROOM) });
  await page.goto("/dispatch");
  const views = page.getByRole("navigation", { name: copy.views.label });
  await expect(views.getByRole("button", { name: copy.views.day })).toHaveAttribute("aria-current", "true");
  const day = page.getByRole("table", { name: copy.day.label("Fri 19 Sep") });
  await expect(day.getByRole("rowheader")).toHaveCount(BOARD.technicians.length);
  expect(await axeViolations(page)).toEqual([]);

  await day.getByRole("button", { name: "Rohit M.", exact: true }).click();
  await press(page, "Move visit");
  const place = day.getByRole("button", { name: `4 pm · ${copy.day.placeLabel("4 pm", "Sandeep Yadav")}` });
  await place.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel(copy.move.start)).toHaveValue("2025-09-19T10:30:00.000Z");

  // The week is a click away, and shows the week of cards.
  await page.keyboard.press("Escape");
  await views.getByRole("button", { name: copy.views.week }).click();
  await expect(page.getByRole("table", { name: copy.day.label("Fri 19 Sep") })).toHaveCount(0);
});

// A visit late in the day was pinned to the board's right edge, over the afternoon, as a table keeps its buttons in view.
test("keeps the day's last hours where they fall when the hours scroll", async ({ page }) => {
  const [imran, ...others] = BOARD.technicians;
  const [friday, ...week] = imran?.days ?? [];
  const visit = friday?.blocks[0];
  if (imran === undefined || friday === undefined || visit === undefined) throw new Error("the board has no visit");
  const late = {
    ...visit,
    appointment_id: "77000000-0000-4000-8000-000000000999",
    starts_at: `${friday.date}T14:00:00.000Z`,
  };
  const board = {
    ...BOARD,
    technicians: [{ ...imran, days: [{ ...friday, blocks: [...friday.blocks, late] }, ...week] }, ...others],
  };
  await page.setViewportSize({ width: 900, height: 800 });
  await answer(page, { [READ_BOARD]: json(board), [READ_ROOM]: json(ROOM) });
  await page.goto("/dispatch");
  const day = page.getByRole("table", { name: copy.day.label("Fri 19 Sep") });
  await expect(day.getByRole("rowheader")).toHaveCount(BOARD.technicians.length);
  const last = day.getByRole("columnheader").last();
  expect(await last.evaluate((head) => getComputedStyle(head).position)).not.toBe("sticky");
});

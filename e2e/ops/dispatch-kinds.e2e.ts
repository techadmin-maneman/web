// Dispatch's visits by kind (docs/decisions/0304-the-work-screens-to-the-22-november-redesign.md): the chips
// narrow the tray and a phone's day as they do the week, and a consultation and fit in one visit is a kind of its
// own. Every name here is made up.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { BOARD, json } from "./fixtures.ts";
import { open, READ_BOARD, ROHIT_BLOCK } from "./dispatch-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";

const kinds = opsCopy.dispatch.kinds;
const SANJAY_BLOCK = "Sanjay B., Sat 20 Sep, 9 am";

const chips = (page: Page) => page.getByRole("radiogroup", { name: kinds.label });
const choose = (page: Page, kind: string) => chips(page).getByRole("radio", { name: kind, exact: true }).click();

test("narrows the visits nobody is on to the kind chosen", async ({ page }) => {
  await open(page);
  const tray = page.getByRole("complementary", { name: opsCopy.dispatch.tray.title });
  const every = await tray.getByRole("listitem").count();
  expect(every).toBeGreaterThan(1);
  await choose(page, kinds.consultation);
  await expect(tray.getByRole("listitem")).toHaveCount(1);
  await expect(tray.getByRole("listitem")).toContainText("DLF 3");
  await choose(page, kinds.all);
  await expect(tray.getByRole("listitem")).toHaveCount(every);
});

test("draws a consultation and fit in one visit as its own kind, apart from a first fit", async ({ page }) => {
  const oneVisit = {
    ...BOARD,
    technicians: BOARD.technicians.map((row) => ({
      ...row,
      days: row.days.map((day) => ({
        ...day,
        blocks: day.blocks.map((block) => (block.client === "Sanjay B." ? { ...block, one_visit: true } : block)),
      })),
    })),
  };
  await open(page, { [READ_BOARD]: json(oneVisit) });
  const sanjay = page.getByRole("button", { name: SANJAY_BLOCK });
  await expect(sanjay).toContainText(`Sec 43 · ${opsCopy.dispatch.oneVisitShort}`);
  await choose(page, kinds.first_fit);
  await expect(sanjay).toHaveCount(0);
  await choose(page, kinds.one_visit);
  await expect(sanjay).toBeVisible();
  await expect(page.getByRole("button", { name: ROHIT_BLOCK })).toHaveCount(0);
});

// A phone's day lists one technician's visits at a time: the chips narrow that list, and say when the day has none.
test("narrows a phone's day to the kind chosen, and says when the day has none of it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.goto("/dispatch?view=day");
  const rohit = page.getByRole("button", { name: /^9 am Rohit M\./ });
  await expect(rohit).toBeVisible();

  // Friday has service visits alone.
  await choose(page, kinds.first_fit);
  await expect(rohit).toHaveCount(0);
  await expect(page.getByText(kinds.none).first()).toBeVisible();

  await choose(page, kinds.service);
  await expect(rohit).toBeVisible();
  await expect(page.getByText(kinds.none)).toHaveCount(0);
});

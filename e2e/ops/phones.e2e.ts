// The console on a phone: it ran the desk's tables off the edge, a figure to a row on Today, and a task squeezed into a
// column a few words wide.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, BOARD, HELD, json, REFERRERS, TASKS, TASKS_READ_ON } from "./fixtures.ts";
import { open as openTechnicians } from "./technicians-fixtures.ts";
import * as opsCopy from "../../apps/ops/src/content.ts";
import { tables } from "../../packages/ui/words.ts";
import { today } from "../../apps/ops/src/content/today.ts";
import { quality } from "../../apps/ops/src/content/quality.ts";
import { partners } from "../../apps/ops/src/content/partners.ts";

const PHONE = { width: 390, height: 844 };

const pageWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

const [, city, jobs] = opsCopy.technicians.columns;

// The heads stood as a wrapped line above the cards; the order is chosen in the bar instead, the heads read aloud.
test("reads a table's rows as cards, each value beside its column's name, the order chosen in the bar", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openTechnicians(page);
  const faizan = page.getByRole("row").filter({ hasText: "Faizan Ali" });
  await expect(faizan.locator("td").first()).toHaveAttribute("data-label", city);
  expect((await faizan.boundingBox())?.width ?? 0).toBeLessThanOrEqual(PHONE.width);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
  await page.getByRole("combobox", { name: tables.sortBy }).selectOption({ label: tables.sortedAs(jobs, true) });
  await expect(page.getByRole("columnheader", { name: jobs })).toHaveAttribute("aria-sort", "ascending");
  expect(await axeViolations(page)).toEqual([]);
});

test("sets Today's figures two to a row", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS), "GET /api/dispatch": json(BOARD) });
  await page.goto("/today");
  const tile = (name: string) => page.locator("main a[href]").filter({ hasText: name }).first();
  await expect(tile(today.tiles.unassigned)).toBeVisible();
  const first = await tile(today.tiles.visits).boundingBox();
  const second = await tile(today.tiles.unassigned).boundingBox();
  if (first === null || second === null) throw new Error("the tiles are not drawn");
  expect(second.y).toBeCloseTo(first.y, 0);
  expect(second.x).toBeGreaterThan(first.x);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

test("reads a task as a list's row: what it is over whom, and when it is due at its right", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/tasks");
  const kunal = page.getByRole("main").getByRole("listitem").filter({ hasText: "Kunal Mehta" });
  const what = await kunal.getByText(opsCopy.tasks.groups.replacement_order).boundingBox();
  const whom = await kunal.getByText(/^Kunal Mehta/).boundingBox();
  const due = await kunal.getByText("3 days overdue").boundingBox();
  if (what === null || whom === null || due === null) throw new Error("the task is not drawn");
  expect(whom.y).toBeGreaterThan(what.y);
  expect(due.x).toBeGreaterThan(what.x + what.width);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

// The bar's Menu, Search and Mine were 32 px tall, and the settings' boxes and buttons 32 to 36: a desk's density. On a
// phone the tab bar stands for the bar, and the page's head carries the search.
test("gives the bar's controls, and a page's boxes and buttons, a finger's height", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, { "GET /api/tasks": json(TASKS) });
  await page.goto("/settings/booking");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const short = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "header button, nav a, main button, main a, main input:not([type=checkbox]):not([type=radio]), main select",
      ),
    ]
      .filter((control) => control.getBoundingClientRect().width > 0)
      .filter((control) => control.getBoundingClientRect().height < 44)
      .map((control) => {
        const name = control.innerText.trim() === "" ? control.getAttribute("aria-label") : control.innerText;
        const height = Math.round(control.getBoundingClientRect().height);
        return `${control.tagName} "${(name ?? "").trim().slice(0, 30)}" ${String(height)} px`;
      }),
  );
  expect(short).toEqual([]);
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(page.getByRole("navigation", { name: opsCopy.shell.title })).toBeVisible();
  // The title stops short of the search beside it.
  const title = await page.getByRole("heading", { level: 1 }).boundingBox();
  const search = await page.getByRole("main").getByRole("button", { name: opsCopy.shell.search }).boundingBox();
  if (title === null || search === null) throw new Error("the head is not drawn");
  expect(title.x + title.width).toBeLessThanOrEqual(search.x);
});

// Money's tabs ran off the screen, and the page open was one of those cut off.
test("keeps every tab in a row in sight, running on to a second line", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/partner-commission");
  const money = page.getByRole("main").getByRole("navigation", { name: opsCopy.shell.nav.money });
  for (const tab of await money.getByRole("link").all()) await expect(tab).toBeInViewport({ ratio: 1 });
});

// The lot's box ran past the screen's edge, and a partner's link past its panel's.
test("keeps a long choice and a long link inside the screen", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const lot = { id: "lot-1", lot_code: "SUPPLIER-LOT-2026-09-21-0004417", consumable_code: "hs-1" };
  await answer(page, {
    "GET /api/recalls": json({
      recalls: [],
      lots: [{ ...lot, name: "Essential 8x10, natural wave, 1B with 20% grey" }],
    }),
  });
  await page.goto("/quality");
  const right = (element: Element) => element.getBoundingClientRect().right;
  expect(await page.getByLabel(quality.lot).evaluate(right)).toBeLessThanOrEqual(PHONE.width);

  const partner = {
    id: "7b0c8e3a-4d5f-4a6b-8c7d-2e3f4a5b6c7d",
    name: "Looks Salon, Sector 29",
    code: "LSK7P2QXLSK7P2QXLSK7P2QX",
    friend_visits: 2,
    valid_days: 180,
    commission: 150000,
    paused_at: null,
    opens: 0,
    referred: 0,
    fitted: 0,
    earned: 0,
    owed: 0,
    discount_code: null,
  };
  await page.clock.setFixedTime(TASKS_READ_ON);
  await answer(page, {
    "GET /api/referrals/held": json(HELD),
    "GET /api/referrers": json(REFERRERS),
    "GET /api/referral-channels": json({
      channels: [partner],
      limits: { max_visits: 12, min_days: 30, max_days: 1095, max_commission: 5000000 },
    }),
  });
  await page.goto("/settings/partners");
  await page.getByRole("button", { name: partners.open(partner.name) }).click();
  const link = page.getByRole("dialog", { name: partner.name }).getByRole("link", { name: new RegExp(partner.code) });
  expect(await link.evaluate(right)).toBeLessThanOrEqual(PHONE.width);
  expect(await pageWidth(page)).toBeLessThanOrEqual(PHONE.width);
});

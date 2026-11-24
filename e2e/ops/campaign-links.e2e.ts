// Campaign links in the shared table, on a phone and at a desk: a link's buttons a line of its card, with no edge of
// their own; its toast clear of the phone's tab bar; and a row pointed at lit to its buttons. A card kept the desk's
// column of buttons in view, beside a hairline, unlit; the toast stood over the tab bar's names.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { answer, json, type OpsReply } from "./fixtures.ts";
import { campaignLinks as copy } from "../../apps/ops/src/content/campaign-links.ts";

const LINKS = {
  links: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "society",
      slug: "green-valley-towers",
      code: "GV2345",
      name: "Green Valley Towers",
      utm_source: "society",
      utm_medium: "offline",
      utm_campaign: "green-valley-towers-20260926",
      city: "Gurgaon",
      pincode: "122002",
      held_date: "2026-09-26",
      discount_code: "SOC20",
      short_link: "https://maneman.in/s/green-valley-towers",
      created_by: "growth@maneman.in",
      created_at: "2026-09-21T06:30:00.000Z",
      retired_at: null,
      spent: 500_000,
      touches: 12,
      people: 3,
    },
  ],
  discount_codes: [
    { id: "44444444-4444-4444-8444-444444444444", code: "SOC20", kind: "percent", value: 20, expires_on: null },
  ],
  sources: ["google", "meta"],
  mediums: ["cpc", "offline"],
  cities: ["Gurgaon"],
} satisfies OpsReply<"/api/campaign-links">;

async function open(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await answer(page, { "GET /api/campaign-links": json(LINKS) });
  await page.goto("/campaign-links");
}

const row = (page: Page) => page.getByRole("row").filter({ hasText: "Green Valley Towers" });

// The redesign says beside the title how many links are live; a retired one is not.
test("says beside its title how many links are live", async ({ page }) => {
  const retired = {
    ...LINKS.links[0],
    id: "55555555-5555-4555-8555-555555555555",
    name: "An old stall",
    retired_at: "2027-09-01T06:00:00.000Z",
  };
  await answer(page, { "GET /api/campaign-links": json({ ...LINKS, links: [...LINKS.links, retired] }) });
  await page.goto("/campaign-links");
  // The fixture's own links are all live; the one added here is retired.
  await expect(page.getByRole("main").getByText(copy.live(LINKS.links.length), { exact: true })).toBeVisible();
});

test("draws a link's buttons on a phone as a line of its card, with no edge of their own", async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  const buttons = row(page).getByRole("cell").last();
  await expect(buttons.getByRole("button", { name: copy.copyLabel("Green Valley Towers") })).toBeVisible();
  await expect(buttons).toHaveCSS("position", "static");
  await expect(buttons).toHaveCSS("box-shadow", "none");
});

test("says a link is copied above the phone's tab bar, clear of its names", async ({ page }) => {
  await open(page, { width: 390, height: 844 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() } });
  });
  await row(page)
    .getByRole("button", { name: copy.copyLabel("Green Valley Towers") })
    .click();
  const toast = await page.getByRole("status").filter({ hasText: copy.copied }).boundingBox();
  const tabs = await page.getByRole("navigation").last().boundingBox();
  if (toast === null || tabs === null) throw new Error("the toast or the tab bar is not drawn");
  // As far above the bar as a desk's toast stands above the window's foot: 24 px.
  expect(tabs.y - (toast.y + toast.height)).toBeCloseTo(24, 0);
});

test("keeps a link's Retire on its row's line, beside its other buttons", async ({ page }) => {
  await open(page, { width: 1440, height: 900 });
  const copied = await row(page)
    .getByRole("button", { name: copy.copyLabel("Green Valley Towers") })
    .boundingBox();
  const retire = await row(page)
    .getByRole("button", { name: copy.retiring.label("Green Valley Towers") })
    .boundingBox();
  if (copied === null || retire === null) throw new Error("Copy or Retire is not drawn");
  expect(retire.y).toBeCloseTo(copied.y, 0);
  expect(retire.x).toBeGreaterThan(copied.x);
});

test("lights a row pointed at to its buttons, at a desk", async ({ page }) => {
  await open(page, { width: 1440, height: 900 });
  const cells = row(page).getByRole("cell");
  await cells.first().hover();
  const lit = await cells.first().evaluate((cell) => getComputedStyle(cell).backgroundColor);
  await expect(cells.last()).toHaveCSS("background-color", lit);
  await expect(cells.last()).toHaveCSS("position", "sticky");
});

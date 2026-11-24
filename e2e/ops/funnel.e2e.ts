// Growth · Funnel (ADR 0288): for a week or a month, try-on to fit, each channel's spend and what it brought with what
// each step cost, the cohorts' revenue after their first fit, what clients told ops, and the dashboards beyond it.

import type { Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { funnel as copy } from "../../apps/ops/src/content/funnel.ts";
import { roundRupees, rupees } from "../../packages/web-kit/money.ts";
import { channelNamed } from "../../src/policy/channels.ts";

const NONE = { spend: 0, leads: 0, consults_booked: 0, consults_done: 0, first_fits: 0, first_fit_revenue: 0 };

const FIGURES = {
  period: "week",
  from: "2026-09-14",
  to: "2026-09-20",
  by: "first",
  rows: [
    {
      channel: "google_ads",
      spend: 5_000_000,
      leads: 6,
      consults_booked: 4,
      consults_done: 3,
      first_fits: 2,
      first_fit_revenue: 6_000_000,
    },
    { channel: "referral", ...NONE, leads: 4, consults_booked: 2, consults_done: 1 },
    { channel: "society", ...NONE, spend: 1_200_000 },
  ],
  totals: {
    spend: 6_200_000,
    leads: 10,
    consults_booked: 6,
    consults_done: 4,
    first_fits: 2,
    first_fit_revenue: 6_000_000,
  },
  cohorts: [{ channel: "google_ads", clients: 2, d30: 6_000_000, d90: 6_000_000, d180: 6_000_000 }],
  cohort_complete: { d30: false, d90: false, d180: false },
  heard: [
    { heard_from: "google", channel: "google_ads", clients: 2 },
    { heard_from: "not_asked", channel: "referral", clients: 1 },
  ],
  tryons: 40,
} satisfies OpsReply<"/api/growth/acquisition">;

// Beside the steps, as the redesign draws them: the period's spend, each first fit's cost, their revenue, the return.
test("sets the period's spend and what its first fits brought back beside the steps", async ({ page }) => {
  await answer(page, { "GET /api/growth/acquisition": json(FIGURES) });
  await page.goto("/funnel");
  // A figure's tile: its name with its value, as "Spend" also names a tab and a column of the channels' table.
  const tile = (label: string, value: string) =>
    page.getByText(label, { exact: true }).locator("..").filter({ hasText: value });
  const { spend, first_fits: fits, first_fit_revenue: revenue } = FIGURES.totals;
  await expect(tile(copy.figures.spend, rupees(spend))).toBeVisible();
  await expect(tile(copy.figures.perFit, roundRupees(spend / fits))).toBeVisible();
  await expect(tile(copy.figures.revenue, rupees(revenue))).toBeVisible();
  await expect(tile(copy.figures.roas, copy.roas(revenue, spend))).toBeVisible();
});

test("shows try-on to fit, each channel's spend and what it brought, cohorts, what clients said, and the dashboards", async ({
  page,
}) => {
  const asked: string[] = [];
  await answer(page, {
    "GET /api/growth/acquisition": (route: Route) => {
      const query = new URL(route.request().url()).searchParams;
      asked.push(`${query.get("period") ?? ""} ${query.get("by") ?? ""}`);
      return json(FIGURES)(route);
    },
  });
  await page.goto("/funnel");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const steps = page.getByRole("region", { name: copy.steps.title });
  await expect(steps.getByRole("listitem")).toHaveText([
    `${copy.steps.tryons}40`,
    `${copy.steps.leads}10`,
    `${copy.steps.booked}6`,
    `${copy.steps.consulted}4`,
    `${copy.steps.fitted}2`,
  ]);
  const channels = page.getByRole("region", { name: copy.channels.title });
  await expect(channels.getByRole("rowheader")).toHaveText([
    ...FIGURES.rows.map((row) => channelNamed(row.channel)),
    copy.channels.total,
  ]);
  await expect(channels.getByRole("row", { name: new RegExp(`^${channelNamed("google_ads")}`) })).toContainText(
    copy.roas(6_000_000, 5_000_000),
  );
  await expect(page.getByRole("region", { name: copy.cohorts.title })).toContainText(
    copy.cohorts.soFar(rupees(6_000_000)),
  );
  await expect(page.getByRole("region", { name: copy.heard.title })).toContainText(copy.heard.notAsked);
  const dashboards = page.getByRole("region", { name: copy.dashboards.title });
  await expect(dashboards.getByRole("link", { name: copy.dashboards.links[0]?.name ?? "" })).toHaveAttribute(
    "href",
    copy.dashboards.links[0]?.href ?? "",
  );
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("combobox", { name: copy.period }).selectOption({ label: copy.periods.month });
  await page.getByRole("combobox", { name: copy.by }).selectOption({ label: copy.bys.last });
  await expect.poll(() => asked).toEqual(["week first", "month first", "month last"]);
});

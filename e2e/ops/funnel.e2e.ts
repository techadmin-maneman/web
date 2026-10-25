// Growth · Funnel: Spend said "Nothing yet", Referrals counted per referrer, and nothing showed try-on to consultation
// to fit, nor how each channel did, nor where the Zoho Analytics dashboards were.

import type { Route } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { answer, json, type OpsReply } from "./answer.ts";
import { funnel as copy } from "../../apps/ops/src/content/funnel.ts";

const NONE = { leads: 0, booked: 0, consulted: 0, fitted: 0 };

const FUNNEL = {
  from: "2026-08-23",
  to: "2026-09-21",
  tryons: 40,
  steps: { leads: 10, booked: 6, consulted: 4, fitted: 2 },
  channels: [
    { channel: "Google Ads", leads: 6, booked: 4, consulted: 3, fitted: 2 },
    { channel: "Meta Ads", ...NONE },
    { channel: "Referral", leads: 4, booked: 2, consulted: 1, fitted: 0 },
    { channel: "Organic search", ...NONE },
    { channel: "Direct", ...NONE },
    { channel: "Offline and partners", ...NONE },
    { channel: "Organic social", ...NONE },
  ],
} satisfies OpsReply<"/api/growth/funnel">;

test("shows try-on to fit with each step's share, each channel that brought someone, and the dashboards", async ({
  page,
}) => {
  const asked: string[] = [];
  await answer(page, {
    "GET /api/growth/funnel": (route: Route) => {
      asked.push(new URL(route.request().url()).searchParams.get("days") ?? "");
      return json(FUNNEL)(route);
    },
  });
  await page.goto("/funnel");
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();

  const steps = page.getByRole("region", { name: copy.steps.title });
  await expect(steps.getByRole("listitem")).toHaveText([
    `${copy.steps.tryons}40`,
    `${copy.steps.leads}10`,
    `${copy.steps.booked}${copy.share(6, 10)}`,
    `${copy.steps.consulted}${copy.share(4, 10)}`,
    `${copy.steps.fitted}${copy.share(2, 10)}`,
  ]);
  const channels = page.getByRole("region", { name: copy.channels.title });
  // Only the channels that brought someone are listed.
  const brought = FUNNEL.channels.filter((each) => each.leads > 0).map((each) => each.channel);
  await expect(channels.getByRole("rowheader")).toHaveText(brought);
  const dashboards = page.getByRole("region", { name: copy.dashboards.title });
  await expect(dashboards.getByRole("link", { name: copy.dashboards.links[0]?.name ?? "" })).toHaveAttribute(
    "href",
    copy.dashboards.links[0]?.href ?? "",
  );
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("combobox", { name: copy.period }).selectOption({ label: copy.periods["90"] });
  await expect.poll(() => asked).toEqual(["30", "90"]);
});

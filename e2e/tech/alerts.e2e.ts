// Alerts (docs/prompts/tech-redesign.md, "Alerts"; docs/decisions/0250-guides-and-alerts.md): Today's bell says how
// many are new and opens the inbox, newest first, which reads them; a row opens its job; Send me turns a kind off; Me
// opens Alerts too, and says how many kinds are on.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech, type Fake } from "./fake-tech.ts";
import { JOB_ID } from "./fixtures.ts";
import { tab } from "./tabs.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const copy = techCopy.alerts;

type Alert = Fake["inbox"]["alerts"][number];

function alertOf(fields: Partial<Alert>): Alert {
  const sent = new Date(Date.now() - 60_000);
  return {
    id: "al-1",
    kind: "time_to_leave",
    read: false,
    sent_at: sent.toISOString(),
    job_id: JOB_ID,
    date: "2026-09-21",
    type: "service",
    sector: "Sector 65",
    client_name: "Rohit M.",
    starts_at: new Date(sent.getTime() + 38 * 60_000).toISOString(),
    was_starts_at: null,
    leave_by: new Date(sent.getTime() + 8 * 60_000).toISOString(),
    drive_minutes: 18,
    finish_by: null,
    jobs: null,
    navigate: null,
    ...fields,
  };
}

const bell = (page: import("@playwright/test").Page) => page.getByRole("link", { name: /^Alerts/ });

test("Today's bell says how many are new, and opens Alerts, which reads them all", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = {
    ...fake.inbox,
    alerts: [
      alertOf({}),
      alertOf({
        id: "al-2",
        kind: "running_over",
        sent_at: new Date(Date.now() - 120_000).toISOString(),
        finish_by: new Date().toISOString(),
      }),
    ],
  };
  await page.goto("/");
  await expect(bell(page)).toHaveAccessibleName(copy.bell(2));

  await bell(page).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
  await expect(page.getByRole("link", { name: /Leave in 8 min for Rohit M\./ })).toBeVisible();
  await expect(page.getByText("18 min drive to Sector 65")).toBeVisible();
  await expect.poll(() => fake.writes.some((write) => write.path === "/api/tech/alerts/read")).toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(bell(page)).toHaveAccessibleName(copy.bell(0));
});

test("a row opens its job", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.inbox = { ...fake.inbox, alerts: [alertOf({})] };
  await page.goto("/alerts");
  await page.getByRole("link", { name: /Leave in 8 min for Rohit M\./ }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));
});

test("says when there are none, and Send me turns a kind off, which Me then counts", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();
  await expect(page.getByRole("link", { name: new RegExp(`^${copy.title}`) })).toContainText(copy.on(4));
  await page.getByRole("link", { name: new RegExp(`^${copy.title}`) }).click();

  await expect(page.getByText(copy.none)).toBeVisible();
  const dayAhead = page.getByRole("switch", { name: copy.kinds.day_ahead.label });
  await expect(dayAhead).toHaveAttribute("aria-checked", "true");
  await dayAhead.click();
  await expect(dayAhead).toHaveAttribute("aria-checked", "false");
  expect(fake.writes.find((write) => write.path === "/api/tech/alerts/settings")?.body).toEqual({ day_ahead: false });
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("button", { name: techCopy.job.back }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByRole("link", { name: new RegExp(`^${copy.title}`) })).toContainText(copy.on(3));
});

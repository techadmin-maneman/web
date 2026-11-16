// Home's hair system, its own page, the four compared (apps/app/src/home/HairSystemBlock.tsx, HairSystemScreen.tsx,
// HairSystemsScreen.tsx), and the alerts under the bell (apps/app/src/alerts/AlertsScreen.tsx). The fitted client's
// Home is answered with the hair system they wear and an alert unread; each answer is held to the API's contract.

import type { Page } from "@playwright/test";
import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

/** Home, with the hair system fitted at the first fit and one alert unread. */
async function wearing(page: Page): Promise<{ next: string }> {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 2, name: appCopy.home.next.label })).toBeVisible();
  const me = await page.evaluate(
    async () => (await fetch("/api/me")).json() as Promise<{ next_visit: { id: string } }>,
  );
  const worn = {
    package: "essential",
    name: "Mane Man Essential",
    fitted_on: client.firstFit.date,
    replace_after_months: 6,
    due_on: client.piece.due,
    replacement_opens_on: `${client.piece.due.slice(0, 7)}-01`,
  };
  await page.route("**/api/me", (route) => route.fulfill({ json: { ...me, hair_system: worn, alerts_unread: 1 } }));
  await page.reload();
  return { next: me.next_visit.id };
}

test("Home shows the hair system worn, its own page every one worn, and the four compared", async ({ page }) => {
  await wearing(page);
  const copy = appCopy.hairSystems;
  await expect(page.getByRole("heading", { level: 2, name: appCopy.home.hairSystem.title })).toBeVisible();
  await expect(page.getByText(/^Month \d of 6$/)).toBeVisible();

  await page.getByRole("link", { name: appCopy.home.hairSystem.history }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.hairSystem })).toBeVisible();
  await expect(page.getByText(copy.wearing)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Mane Man Essential" })).toBeVisible();
  // The first fit fitted it, from its day to now.
  await expect(page.getByRole("link", { name: copy.fittingVisit })).toHaveAttribute(
    "href",
    `/visits/${fittedClient().firstFit.id}`,
  );
  expect(await axeViolations(page)).toEqual([]);

  await page.getByRole("link", { name: copy.compare }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.hairSystems })).toBeVisible();
  const essential = page.getByRole("article", { name: "Mane Man Essential" });
  await expect(essential.getByText(copy.wearing)).toBeVisible();
  await expect(page.getByText(copy.gst)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("the bell counts the alerts unread, and the inbox opens what each is about, marking them read", async ({
  page,
}) => {
  const { next } = await wearing(page);
  const alerts = [
    { id: "a1", kind: "visit_reminder", visit_id: next, update: null, at: new Date().toISOString(), read: false },
    { id: "a2", kind: "payment_receipt", visit_id: null, update: null, at: "2026-10-01T06:00:00.000Z", read: true },
  ];
  let read = false;
  await page.route("**/api/me/alerts", (route) => route.fulfill({ json: { alerts, push_key: null } }));
  await page.route("**/api/me/alerts/read", async (route) => {
    read = true;
    await route.fulfill({ status: 204 });
  });

  await page.getByRole("link", { name: appCopy.shell.alerts(1) }).click();
  await expect(page.getByRole("heading", { level: 1, name: appCopy.titles.alerts })).toBeVisible();
  const today = page.getByRole("region", { name: appCopy.alerts.today });
  await expect(today.getByText(appCopy.ALERTS.visit_reminder?.title ?? "")).toBeVisible();
  await expect(today.getByText(appCopy.alerts.unread)).toBeVisible();
  const earlier = page.getByRole("region", { name: appCopy.alerts.earlier });
  await expect(earlier.getByText(appCopy.ALERTS.payment_receipt?.title ?? "")).toBeVisible();
  await expect.poll(() => read).toBe(true);
  expect(await axeViolations(page)).toEqual([]);

  await today.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/visits/${next}$`));
});

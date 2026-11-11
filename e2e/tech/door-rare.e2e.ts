// The door's rare cases (docs/decisions/0243-job-and-the-door.md, left from PR 5): a check-in refused as early and made
// again with no signal stays at the door, and one measured too far says Try again at once, never Check in.

import { expect, test } from "../support.ts";
import { JOB_ID } from "./fixtures.ts";
import { fakeTech } from "./fake-tech.ts";
import { atTheDoor } from "./on-phone.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

const foot = (page: import("@playwright/test").Page) => page.locator("main > div").last().getByRole("button");

test("a check-in refused as early, made again with no signal, waits at the door", async ({ page, context }) => {
  const fake = await fakeTech(page);
  fake.checkInEarly = true;
  await atTheDoor(page);
  await page.goto(`/jobs/${JOB_ID}`);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  // Refused as early: the job says when check-in opens.
  await expect(page.getByText(new RegExp(techCopy.notHome.arrived.opensAt(".+")))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}$`));

  // Later, in the basement: the tap waits for signal, and the technician waits at the door.
  fake.checkInEarly = false;
  fake.online = false;
  await context.setOffline(true);
  await page.getByRole("button", { name: techCopy.notHome.arrived.action }).click();
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/door$`));
  await expect(page.getByRole("heading", { level: 1, name: techCopy.notHome.door.title })).toBeVisible();
  // And stays there: the early refusal before it is no longer the last word.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(new RegExp(`/jobs/${JOB_ID}/door$`));
});

test("a check-in measured too far says Try again at once, and never Check in for a moment", async ({ page }) => {
  const fake = await fakeTech(page);
  fake.checkIn = { passed: false, distance_m: 1400 };
  await atTheDoor(page, 28.42, 77.12);
  await page.goto(`/jobs/${JOB_ID}`);
  await expect(foot(page)).toHaveText(techCopy.job.checkIn);

  // Every word the action shows from the tap on.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seen });
    new MutationObserver(() => {
      const action = [...document.querySelectorAll("main > div")].at(-1)?.querySelector("button");
      seen.push(action?.textContent ?? "");
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await foot(page).click();
  await expect(foot(page)).toHaveText(techCopy.job.retry);
  await page.waitForTimeout(1500);

  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.slice(seen.indexOf(techCopy.job.retry))).not.toContain(techCopy.job.checkIn);
});

// The technician saw nothing of how they were doing or what they had earned this month, and had no way to ask for
// leave but a call. Who they are, their quality and incentives are on Me; the week ahead is Schedule's (./schedule.e2e.ts).

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import * as techCopy from "../../apps/tech/src/content.ts";
import { tab } from "./tabs.ts";

test("shows who they are, their quality and this month's incentives on Me", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();
  const { me, month } = techCopy;
  await expect(page.getByText(me.who("Senior", "Gurugram", "+91 98100 00009"))).toBeVisible();
  const quality = page.getByRole("region", { name: me.quality.title });
  await expect(quality.getByRole("definition")).toHaveText([me.quality.redone(1, 9), me.quality.onTimeShare(17, 18)]);
  const incentives = page.getByRole("region", { name: /^Incentives, / });
  await expect(incentives).toContainText("Rs. 5,400");
  await expect(incentives.getByRole("term")).toHaveText([
    me.incentives.line(month.kinds.service, 12, "Rs. 450"),
    me.incentives.line(month.kinds.first_fit, 2, null),
  ]);
  await expect(incentives.getByRole("definition")).toHaveText(["Rs. 5,400", me.incentives.noRate]);
  expect(await axeViolations(page)).toEqual([]);
});

test("asks for leave from the phone, and shows the ask with ops", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await tab(page, techCopy.tabs.me).click();
  await page.getByRole("link", { name: techCopy.me.leave, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.leave.title })).toBeVisible();
  await expect(page.getByText(techCopy.leave.none)).toBeVisible();
  await page.getByLabel(techCopy.leave.note).fill("Sister's wedding");
  await page.getByRole("button", { name: techCopy.leave.ask, exact: true }).click();
  await expect(page.getByText(techCopy.leave.states.asked)).toBeVisible();
  expect(fake.writes.at(-1)?.body).toMatchObject({ note: "Sister's wedding" });
  expect(await axeViolations(page)).toEqual([]);
});

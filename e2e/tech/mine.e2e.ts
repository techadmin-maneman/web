// The technician saw only today and tomorrow: no week ahead, and nothing of what they had done or earned this month.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fakeTech } from "./fake-tech.ts";
import * as techCopy from "../../apps/tech/src/content.ts";

test("opens the technician's next six days from Today, a day at a time", async ({ page }) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByRole("link", { name: techCopy.week.link }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.week.title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(6);
  await expect(page.getByText(techCopy.week.none).first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("shows the technician's own month: visits by kind, what each earned, and a kind with no rate set yet", async ({
  page,
}) => {
  await fakeTech(page);
  await page.goto("/");
  await page.getByRole("link", { name: techCopy.month.link }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.month.title })).toBeVisible();
  await expect(page.getByRole("term")).toHaveText([
    techCopy.month.line(techCopy.month.kinds.service, 12),
    techCopy.month.line(techCopy.month.kinds.first_fit, 2),
    techCopy.month.total,
  ]);
  await expect(page.getByRole("definition")).toHaveText(["Rs. 5,400", techCopy.month.noRate, "Rs. 5,400"]);
  expect(await axeViolations(page)).toEqual([]);
});

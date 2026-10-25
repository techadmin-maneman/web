// The technician saw only today and tomorrow: no week ahead, nothing of what they had done or earned this month, and no
// way to ask for leave but a call.

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

test("asks for leave from the phone, and shows the ask with ops", async ({ page }) => {
  const fake = await fakeTech(page);
  await page.goto("/");
  await page.getByRole("link", { name: techCopy.leave.link }).click();
  await expect(page.getByRole("heading", { level: 1, name: techCopy.leave.title })).toBeVisible();
  await expect(page.getByText(techCopy.leave.none)).toBeVisible();
  await page.getByLabel(techCopy.leave.note).fill("Sister's wedding");
  await page.getByRole("button", { name: techCopy.leave.ask, exact: true }).click();
  await expect(page.getByText(techCopy.leave.states.asked)).toBeVisible();
  expect(fake.writes.at(-1)?.body).toMatchObject({ note: "Sister's wedding" });
  expect(await axeViolations(page)).toEqual([]);
});

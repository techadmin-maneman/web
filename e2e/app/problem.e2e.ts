// Something wrong told to Care from the app (src/routes/client/problems.ts): a fitted client says, from Home or from a
// visit, what is wrong in their own words, and is pointed to WhatsApp for the photographs.

import { expect, test } from "../support.ts";
import { axeViolations } from "../a11y.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";
import * as appCopy from "../../apps/app/src/content.ts";

const copy = appCopy.problem;

test("tells Care what is wrong with the hair system, from Home, and offers WhatsApp for photographs", async ({
  page,
}) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await page.getByRole("button", { name: copy.link.hair_system }).click();

  // The sheet is named by its heading, which says it was sent once it was.
  const sheet = page.getByRole("dialog");
  await expect(sheet).toHaveAccessibleName(copy.title.hair_system);
  await sheet.getByRole("textbox", { name: copy.label }).fill("It lifts at the front.");
  await sheet.getByRole("button", { name: copy.send }).click();
  await expect(sheet.getByRole("heading", { name: copy.sent })).toBeVisible();
  await expect(sheet.getByRole("link", { name: copy.addPhotos })).toHaveAttribute("href", /wa\.me/);
  expect(await axeViolations(page)).toEqual([]);
});

test("offers the same on a visit that is done", async ({ page }) => {
  const client = fittedClient();
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { level: 1, name: "Your next visit" })).toBeVisible();
  await page.goto(`/visits/${client.firstFit.id}`);
  await page.getByRole("button", { name: copy.link.visit }).click();
  await expect(page.getByRole("dialog", { name: copy.title.visit })).toBeVisible();
});

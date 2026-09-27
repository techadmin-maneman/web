// The owner's ruling of 27 September 2026 (ADR 0082): a client who made a
// try-on on the site sees, in the app's Photos tab, the photograph they
// uploaded beside the look made from it, and how long each is kept. The client
// has a consultation booked and no visit done (e2e/app/try-on.ts), so the
// empty state's lines for visit photographs follow the try-on.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { fullDate, indiaClock, indiaDate, longDate } from "../../packages/web-kit/dates.ts";
import { expect, test } from "../support.ts";
import { logIn } from "./signed-in.ts";
import { tryOnClient } from "./try-on.ts";

const HOUR = 60 * 60 * 1000;

const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name });

/** A thumbnail's picture has arrived: 600 px wide, as seeded. */
const arrived = async (button: ReturnType<Page["getByRole"]>) =>
  expect.poll(() => button.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(600);

test("Photos shows the try-on's photograph beside its look, each opening in the sheet", async ({ page }) => {
  const client = tryOnClient();
  const madeOn = indiaDate(client.createdAt);
  const date = fullDate(madeOn);
  await logIn(page, client.mobile);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  await tab(page, "Photos").click();

  const tryOn = page.getByRole("region", { name: date });
  await expect(tryOn.getByText("Your try-on")).toBeVisible();
  const photo = tryOn.getByRole("button", { name: `Your photograph, try-on of ${date}` });
  const look = tryOn.getByRole("button", { name: `Your look, try-on of ${date}` });
  await arrived(photo);
  await arrived(look);
  // The photograph is kept an hour after the look was asked for; the look until it expires.
  const photoUntil = new Date(Date.parse(client.createdAt) + HOUR).toISOString();
  await expect(
    tryOn.getByText(
      `Your photograph is kept until ${indiaClock(photoUntil)}, the look until ${longDate(client.expiresAt)}.`,
    ),
  ).toBeVisible();
  // No visit has photographs yet: board D3's lines, beneath the try-on.
  await expect(page.getByText("Your photographs start at your first fit.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Compare" })).toHaveCount(0);

  await look.click();
  const sheet = page.getByRole("dialog", { name: `Your look · ${date}` });
  await expect(sheet.getByAltText(`Your look, try-on of ${date}`)).toBeVisible();
  const download = page.waitForEvent("download");
  await sheet.getByRole("link", { name: "Download" }).click();
  // The file's own type names its extension.
  expect((await download).suggestedFilename()).toBe(`mane-man-${madeOn}-try-on-look.jpg`);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();

  await photo.click();
  await expect(page.getByRole("dialog", { name: `Your photograph · ${date}` })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test("the tab meets WCAG 2.2 AA with a try-on above the empty state", async ({ page }) => {
  await logIn(page, tryOnClient().mobile);
  await expect(page.getByRole("heading", { name: "Your consultation" })).toBeVisible();
  await tab(page, "Photos").click();
  await expect(page.getByText("Your try-on")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

// The site's tags (site/src/lib/analytics.ts): each starts with every consent denied, none is given an address's
// fragment, and none starts on /stop, whose address carries the token that stops a person's messages.

import { consentBar } from "../site/src/content/site.ts";
import { axeViolations } from "./a11y.ts";
import { expect, test, analyticsCommands } from "./support.ts";

const DENIED = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
};

const GRANTED = {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
};

test.describe("the cookie bar", () => {
  test.use({ consentBarAsks: true });

  test("asks until answered, and a decline keeps every tag denied", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("region", { name: consentBar.label });
    await expect(bar).toContainText(consentBar.text);
    expect(await axeViolations(page, (axe) => axe.include("[data-consent-bar]"))).toEqual([]);
    await bar.getByRole("button", { name: consentBar.decline }).click();
    await expect(bar).toBeHidden();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "update", DENIED]);

    await page.goto("/guides");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(bar).toBeHidden();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "default", DENIED]);
  });

  test("an accept grants Google's tags, here and on the next page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: consentBar.accept }).click();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "update", GRANTED]);

    await page.goto("/guides");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "default", GRANTED]);
  });
});

test("starts every tag with consent denied, and gives none an address’s fragment", async ({ page }) => {
  await page.goto("/#faq");
  const commands = await analyticsCommands(page);
  expect(commands).toContainEqual(["consent", "default", DENIED]);
  expect(commands).toContainEqual(["set", { page_location: `${new URL(page.url()).origin}/` }]);
});

test("starts no tag on /stop", async ({ page }) => {
  await page.goto("/stop#a-stop-token");
  expect(await analyticsCommands(page)).toEqual([]);
});

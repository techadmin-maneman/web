// The site's tags (site/src/lib/analytics.ts): each starts with every consent denied, none is given an address's
// fragment, and none starts on /stop, whose address carries the token that stops a person's messages.

import { expect, test, analyticsCommands } from "./support.ts";

const DENIED = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
};

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

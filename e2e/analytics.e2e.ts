// The site's tags (site/src/lib/analytics.ts): each starts with every consent denied, none is given an address's
// fragment, and none starts on /stop, whose address carries the token that stops a person's messages.

import type { Locator, Page } from "@playwright/test";
import { consentBar, stickyBar } from "../site/src/content/site.ts";
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

/** The page scrolled to its end at once, not over the smooth scroll's time. */
const toTheEnd = (page: Page) =>
  page.evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
  });

/** How far a footer's line stands above the cookie bar: below zero, the bar covers it. */
async function clearance(line: Locator, bar: Locator): Promise<number> {
  const [above, under] = [await line.boundingBox(), await bar.boundingBox()];
  return (under?.y ?? 0) - ((above?.y ?? 0) + (above?.height ?? 0));
}

test.describe("the cookie bar", () => {
  test.use({ consentBarAsks: true });

  test("asks until answered, and a decline keeps every tag denied", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("region", { name: consentBar.label });
    await expect(bar).toContainText(consentBar.text);
    // No answer is kept yet, so none is said.
    await expect(bar.getByText(consentBar.chosen.granted)).toBeHidden();
    await expect(bar.getByText(consentBar.chosen.denied)).toBeHidden();
    expect(await axeViolations(page, (axe) => axe.include("[data-consent-bar]"))).toEqual([]);
    // The API hears of it, so nothing the browser's touches kept for Meta is sent (ADR 0288).
    const declined = page.waitForRequest(
      (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/landings/declined",
    );
    await bar.getByRole("button", { name: consentBar.decline }).click();
    await declined;
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

  test("comes back from Cookie choices in the footer, so an accept can become a decline", async ({ page }) => {
    await page.goto("/guides");
    const bar = page.getByRole("region", { name: consentBar.label });
    await bar.getByRole("button", { name: consentBar.accept }).click();
    await expect(bar).toBeHidden();

    const choices = page.getByRole("contentinfo").getByRole("button", { name: consentBar.change });
    await choices.click();
    await expect(bar).toBeVisible();
    // The bar opens over the footer: the focus goes to the bar, neither answer, and back to the button once answered.
    await expect(bar).toBeFocused();
    await expect(bar.getByText(consentBar.chosen.granted)).toBeVisible();
    await expect(bar.getByText(consentBar.chosen.denied)).toBeHidden();
    await bar.getByRole("button", { name: consentBar.decline }).click();
    await expect(bar).toBeHidden();
    await expect(choices).toBeFocused();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "update", DENIED]);
    await page.reload();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "default", DENIED]);
  });

  // The home page's footer kept no room for the bar, which covered its last line.
  test("keeps the bar's room beneath the home page's footer", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("region", { name: consentBar.label });
    await expect(bar).toBeVisible();
    await toTheEnd(page);
    // Its last line: the social links, beneath Cookie choices on a phone.
    const last = page.getByRole("contentinfo").getByRole("link").last();
    await expect.poll(() => clearance(last, bar)).toBeGreaterThanOrEqual(0);
  });

  // The bar's room on a phone's flow lost the foot bar's height it had counted: /try's buttons still clear it.
  test("leaves the try-on's buttons above it", async ({ page }) => {
    await page.goto("/try");
    const bar = page.getByRole("region", { name: consentBar.label });
    await expect(bar).toBeVisible();
    await toTheEnd(page);
    const last = page.getByRole("main").getByRole("button").last();
    await expect(last).toBeVisible();
    await expect.poll(() => clearance(last, bar)).toBeGreaterThanOrEqual(0);
  });

  // A browser that refused storage said no answer when the bar came back, though one was given on the page.
  test("says the answer given on the page, where storage refuses to keep it", async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Refused", "SecurityError");
      };
    });
    await page.goto("/guides");
    const bar = page.getByRole("region", { name: consentBar.label });
    await bar.getByRole("button", { name: consentBar.accept }).click();
    await page.getByRole("contentinfo").getByRole("button", { name: consentBar.change }).click();
    await expect(bar.getByText(consentBar.chosen.granted)).toBeVisible();
  });

  // It stood a foot bar's height above the window's foot while the home page's bar was still down beneath the hero.
  test("stands at the window's foot until a phone's home bar is up, then above it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "390", "only a phone's home page has the foot bar");
    await page.goto("/");
    const bar = page.getByRole("region", { name: consentBar.label });
    const foot = page.getByRole("navigation", { name: stickyBar.label });
    const bottom = async () => {
      const box = await bar.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    };
    await expect(foot).toBeHidden();
    expect(page.viewportSize()?.height ?? 0).toBeCloseTo((await bottom()) + 16, 0);

    await page.locator('[data-section="range"]').evaluate((section) => {
      section.scrollIntoView();
    });
    await expect(foot).toBeVisible();
    // Within a pixel of the 16 px gap, once the foot bar has slid up.
    const gap = async () => ((await foot.boundingBox())?.y ?? 0) - (await bottom());
    await expect.poll(async () => Math.abs((await gap()) - 16)).toBeLessThanOrEqual(1);
  });

  test("keeps a decline while Cookie choices asks again, until another answer is picked", async ({ page }) => {
    await page.goto("/guides");
    const bar = page.getByRole("region", { name: consentBar.label });
    await bar.getByRole("button", { name: consentBar.decline }).click();
    await page.reload();

    const choices = page.getByRole("contentinfo").getByRole("button", { name: consentBar.change });
    await choices.click();
    await expect(bar).toBeVisible();
    await expect(bar.getByText(consentBar.chosen.denied)).toBeVisible();
    await expect(bar.getByText(consentBar.chosen.granted)).toBeHidden();
    expect(await analyticsCommands(page)).not.toContainEqual(["consent", "update", GRANTED]);
    // The footer keeps the bar's room beneath its last line: Cookie choices scrolls clear above the bar.
    await toTheEnd(page);
    await expect.poll(() => clearance(choices, bar)).toBeGreaterThanOrEqual(0);
    await page.reload();
    await expect(bar).toBeHidden();
    expect(await analyticsCommands(page)).toContainEqual(["consent", "default", DENIED]);
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

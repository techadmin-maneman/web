// The referral landing's island wakes once the page is idle (site/src/pages/r/index.astro): a pincode typed and Check
// tapped before then send nothing and reload nothing, and as the island wakes it keeps the pincode and answers the tap.

import { HOUSE_CARD } from "../src/config/house-card.ts";
import type { Page } from "@playwright/test";
import { expect, fakeTurnstile, mockNumberCode, test } from "./support.ts";
import * as referralCopy from "../site/src/content/referral.ts";

const CODE = "RM4K7P";
const INVITE = {
  state: "valid" as const,
  referrer_first_name: "Rohit",
  partner: null,
  friend_visits: null,
  discount: null,
  card: { state: "personal" as const, version: 2 },
};
const SERVED = { pincode: "122018", served: true, area: "Sector 65", city: "Gurgaon" };

/** The API as the landing meets it; the count is how many times the pincode was checked. */
async function mockLanding(page: Page): Promise<() => number> {
  await fakeTurnstile(page);
  await mockNumberCode(page);
  await page.route(/\/api\/availability\/public\?/, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: INVITE }));
  await page.route("**/api/og/*", (route) => route.fulfill({ status: 302, headers: { location: HOUSE_CARD } }));
  let checked = 0;
  await page.route("**/api/pincodes/*", (route) => {
    checked += 1;
    return route.fulfill({ json: SERVED });
  });
  return () => checked;
}

test("keeps a pincode typed before the page has woken, and answers a Check tapped then as it wakes", async ({
  page,
}) => {
  const checked = await mockLanding(page);
  // As Safari before 16, which has no requestSubmit.
  await page.addInitScript(() => {
    Reflect.deleteProperty(HTMLFormElement.prototype, "requestSubmit");
  });

  // The island's script is held until the visitor has typed and tapped.
  let wake: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    wake = resolve;
  });
  await page.route("**/_astro/Landing.*.js", async (route) => {
    await held;
    await route.continue();
  });
  // A mark on the page that only a reload would clear; the form's own steps write the history, not a new page.
  const stillThisPage = () => page.evaluate(() => (window as Window & { mark?: boolean }).mark === true);

  await page.goto(`/r/${CODE}`);
  await page.evaluate(() => {
    (window as Window & { mark?: boolean }).mark = true;
  });
  const field = page.getByLabel(referralCopy.referral.pincode.label);
  await field.fill(SERVED.pincode);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  await expect(field).toHaveValue(SERVED.pincode);
  await expect(page.getByRole("button", { name: referralCopy.referral.pincode.checking })).toBeVisible();
  expect(await stillThisPage()).toBe(true);
  expect(checked()).toBe(0);

  wake();
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  await expect(page.getByText("Rohit sent you this")).toBeVisible();
  await expect(page.getByRole("heading", { name: referralCopy.referral.consultation.title })).toBeVisible();
  expect(checked()).toBe(1);
  expect(await stillThisPage()).toBe(true);
});

test("answers an early Check of a pincode that is not one as a tap would, and leaves Check as it was", async ({
  page,
}) => {
  const checked = await mockLanding(page);
  let wake: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    wake = resolve;
  });
  await page.route("**/_astro/Landing.*.js", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto(`/r/${CODE}`);
  await page.getByLabel(referralCopy.referral.pincode.label).fill("12");
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  wake();
  await expect(page.getByText(referralCopy.referral.pincode.invalid)).toBeVisible();
  const button = page.getByRole("button", { name: referralCopy.referral.pincode.check, exact: true });
  await expect(button).toHaveAttribute("aria-disabled", "false");
  expect(checked()).toBe(0);
});

test("checks a pincode once for a Check tapped once the page has woken", async ({ page }) => {
  const checked = await mockLanding(page);
  await page.goto(`/r/${CODE}`);
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  await page.getByLabel(referralCopy.referral.pincode.label).fill(SERVED.pincode);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  await expect(page.getByRole("heading", { name: referralCopy.referral.consultation.title })).toBeVisible();
  expect(checked()).toBe(1);
  // The page notes only a tap that nothing answered.
  await expect(page.locator("#invite")).not.toHaveAttribute("data-checked");
});

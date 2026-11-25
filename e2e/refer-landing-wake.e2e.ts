// The referral landing's island wakes once the page is idle (site/src/pages/r/index.astro): a pincode typed and Check
// tapped before then send nothing and reload nothing, and the pincode is still in its field when the island wakes.

import { HOUSE_CARD } from "../src/config/house-card.ts";
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

test("keeps a pincode typed before the page has woken, and reloads nothing for a Check tapped then", async ({
  page,
}) => {
  await fakeTurnstile(page);
  await mockNumberCode(page);
  await page.route(/\/api\/availability\/public\?/, (route) =>
    route.fulfill({ status: 503, json: { error: { code: "unavailable", request_id: "r" } } }),
  );
  await page.route(`**/api/r/${CODE}`, (route) => route.fulfill({ json: INVITE }));
  await page.route("**/api/og/*", (route) => route.fulfill({ status: 302, headers: { location: HOUSE_CARD } }));
  await page.route("**/api/pincodes/*", (route) => route.fulfill({ json: SERVED }));

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
  expect(await stillThisPage()).toBe(true);

  wake();
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
  await expect(page.getByText("Rohit sent you this")).toBeVisible();
  await expect(field).toHaveValue(SERVED.pincode);
  await page.getByRole("button", { name: referralCopy.referral.pincode.check }).click();
  await expect(page.getByRole("heading", { name: referralCopy.referral.consultation.title })).toBeVisible();
  expect(await stillThisPage()).toBe(true);
});

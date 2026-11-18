// Razorpay's own Checkout under the client app's policy: the one browser test that lets the real script in, from
// Razorpay. Checkout pulls in more than checkout.js (risk detection that Razorpay's fraud checks rely on, its logging
// hosts, styles of its own), and anything the policy refuses in the app's page fails this test. Older builds of
// checkout.js fetch risk detection as a script of its own from Razorpay's CDN; newer ones carry it inside and send what
// it finds to the logging host. Razorpay serves both, so either is taken, and a script it fetches must load.
//
// It takes @playwright/test's own `test`, not e2e/support.ts's: that one reads the console of every frame, and
// Razorpay's payment frame answers to Razorpay's policy, not the app's.

import { expect, test } from "@playwright/test";
import { recordPolicyRefusals } from "../../scripts/lib/csp-refusals.ts";
import { login } from "../../apps/app/src/content.ts";

const CHECKOUT = "https://checkout.razorpay.com/v1/checkout.js";
const RISK_DETECTION = "https://cdn.razorpay.com/static/cx/razorpay-risk-detection/bundle.js";
const PAYMENT_FRAME = "https://api.razorpay.com/";

type Razorpay = new (options: object) => { open(): void };

test("loads and opens Razorpay’s own Checkout with nothing refused", async ({ page }) => {
  const refused = await recordPolicyRefusals(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: login.mobile.title })).toBeVisible();

  const riskDetection: number[] = [];
  page.on("response", (response) => {
    if (response.url() === RISK_DETECTION) riskDetection.push(response.status());
  });
  // Loaded as the pay step loads it (apps/app/src/booking/checkout.ts); the policy is the same on every page.
  // Checkout runs its risk detection on a few page loads in a hundred (it returns early above a random number), so
  // while its script runs this page is made one of them, and has its own randomness back once the script has loaded.
  await page.evaluate((src) => {
    const random = Math.random;
    Math.random = () => 0;
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", () => {
      Math.random = random;
    });
    document.head.append(script);
  }, CHECKOUT);
  await page.waitForFunction(() => "Razorpay" in window);

  // A test key of no account: Checkout shows its frame, which then says the key is wrong.
  await page.evaluate(() => {
    const Checkout = (window as unknown as { Razorpay: Razorpay }).Razorpay;
    new Checkout({ key: "rzp_test_policycheck", amount: 200000, currency: "INR", name: "Mane Man" }).open();
  });
  // Checkout readies a payment frame as its script runs, and opening it may put another in its place: the one still
  // attached is the one that loads.
  await expect(async () => {
    const frame = page.frames().find((each) => each.url().startsWith(PAYMENT_FRAME) && !each.isDetached());
    if (frame === undefined) throw new Error("no payment frame yet");
    await frame.waitForLoadState();
  }).toPass();
  // Checkout sends its logs once a second.
  await page.waitForTimeout(2_000);

  expect(refused, "the app’s policy refused part of Checkout").toEqual([]);
  expect(riskDetection.every((status) => status >= 200 && status < 300)).toBe(true);
});

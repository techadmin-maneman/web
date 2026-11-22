import { expect, test } from "../support.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment, OPEN_DAYS, OPEN_TIMES } from "./picking.ts";
import { toPayment, openSheet, scanOf, AGREE_TERMS } from "./booking-fixtures.ts";
import * as appCopy from "../../apps/app/src/content.ts";
import { PAY_SERVICE } from "./booking-fixtures.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

test("takes focus to the review’s heading as the sheet moves on", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await openSheet(page);
  const sheet = page.getByRole("dialog");
  await continueToPayment(page);
  await expect(sheet.getByRole("heading", { name: appCopy.booking.pay.title })).toBeFocused();
});

test("makes the days one tab stop, with arrow keys between, and the times the next", async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: appCopy.booking.when.title });
  const dates = sheet.locator(OPEN_DAYS);
  await dates.first().click();
  await page.keyboard.press("ArrowRight");
  await expect(dates.nth(1)).toBeChecked();
  await expect(dates.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(sheet.locator(OPEN_TIMES).first()).toBeFocused();
});

// Clients are steered to the times that drive least (docs/decisions/0293-steering-booking-times.md).
test("marks the day's times that drive least Recommended, no more of them than ops set", async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: appCopy.booking.when.title });
  await expect(sheet.locator(OPEN_TIMES).first()).toBeAttached();
  const marked = sheet
    .locator("label")
    .filter({ has: page.locator(OPEN_TIMES) })
    .filter({
      hasText: appCopy.booking.when.recommended,
    });
  await expect(marked.first()).toBeVisible();
  expect(await marked.count()).toBeLessThanOrEqual(3);
});

test("scrolls the days sideways on a 320 px screen, and never the page", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: appCopy.booking.when.title });
  const strip = sheet.getByRole("radiogroup").first();
  await expect(sheet.locator(OPEN_DAYS).first()).toBeVisible();
  expect(await strip.evaluate((days) => days.scrollWidth > days.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("has a Close anyone can see, a full target, ringed in the ink on the white it stands on", async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: appCopy.booking.when.title });
  const close = sheet.getByRole("button", { name: appCopy.booking.close });
  await expect(close).toBeVisible();
  expect(await close.evaluate((button) => getComputedStyle(button).opacity)).toBe("1");
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  for (
    let press = 0;
    press < 25 && !(await close.evaluate((button) => button === document.activeElement));
    press += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(close).toBeFocused();
  // The design has no focus ring, so it follows the ground: the ink on the sheet's white.
  expect(await close.evaluate((button) => getComputedStyle(button).outlineColor)).toBe("rgb(22, 35, 58)");
});

// Axe read the day and time and the review only; the states where a client is told something went wrong went unread.
test("the payment’s outcomes meet WCAG 2.2 AA: failed, and the time gone back", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await page.clock.install();
  await toPayment(page);
  await page.getByRole("checkbox", { name: AGREE_TERMS }).check();
  await page.getByRole("button", { name: PAY_SERVICE }).click();
  await expect(
    page
      .getByRole("dialog", { name: appCopy.booking.pay.title })
      .getByRole("alert")
      .getByText(appCopy.booking.failed.title),
  ).toBeVisible();
  await scanOf(page);

  await page.clock.fastForward("11:00");
  await expect(page.getByRole("dialog", { name: appCopy.booking.expired.title })).toBeVisible();
  await scanOf(page);
});

test("a confirmed booking meets WCAG 2.2 AA", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await toPayment(page);
  await page.getByRole("checkbox", { name: AGREE_TERMS }).check();
  await page.getByRole("button", { name: PAY_SERVICE }).click();
  await expect(page.getByRole("dialog", { name: appCopy.booking.confirmed.label.service })).toBeVisible({
    timeout: 15_000,
  });
  await scanOf(page);
});

// Every app project runs with reduced motion, so the sheets' movement was never read by axe or the keyboard.
test.describe("with motion, as most phones have it", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the booking sheet rises and moves between steps, keeps the focus in it, and meets WCAG 2.2 AA", async ({
    page,
  }) => {
    await openSheet(page);
    const when = page.getByRole("dialog", { name: appCopy.booking.when.title });
    await expect(when).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => when.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);

    await continueToPayment(page);
    const review = page.getByRole("dialog", { name: appCopy.booking.pay.title });
    await expect(review).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => review.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);
  });
});

test("each booking step meets WCAG 2.2 AA", async ({ page }) => {
  const scan = () => scanOf(page);
  await fakeCheckout(page, "paid");
  await openSheet(page);
  await expect(page.getByRole("dialog", { name: appCopy.booking.when.title })).toBeVisible();
  await scan();
  await continueToPayment(page);
  await expect(page.getByRole("dialog", { name: appCopy.booking.pay.title })).toBeVisible();
  await scan();
});

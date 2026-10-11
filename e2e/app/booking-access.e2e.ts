import { expect, test } from "../support.ts";
import { confirmedByRazorpay, fakeCheckout, noRealCheckout } from "./checkout-fakes.ts";
import { continueToPayment } from "./picking.ts";
import { toPayment, openSheet, scanOf } from "./booking-fixtures.ts";

// One client, one hold at a time: a new hold lets the client's earlier one go, so these run one after another, in
// order. One failing leaves the rest to run.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await noRealCheckout(page);
});

test("takes focus to each step's heading as the sheet moves on", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await openSheet(page);
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio").and(page.locator(":enabled")).first().click();
  await sheet.getByRole("button", { name: "Continue" }).click();
  await expect(sheet.getByRole("heading", { name: "Pick a time" })).toBeFocused();
  await continueToPayment(page);
  await expect(sheet.getByRole("heading", { name: "Pay and confirm" })).toBeFocused();
});

test("makes the days one tab stop, with arrow keys between", async ({ page }) => {
  await openSheet(page);
  const dates = page.getByRole("dialog", { name: "Pick a date" }).getByRole("radio").and(page.locator(":enabled"));
  await dates.first().click();
  await page.keyboard.press("ArrowRight");
  await expect(dates.nth(1)).toBeChecked();
  await expect(dates.nth(1)).toBeFocused();
  await page.keyboard.press("Tab");
  // "Later dates" sits between the days and Continue.
  await expect(page.getByRole("button", { name: "Later dates" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue" })).toBeFocused();
});

test("fits all fourteen days on a 320 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  const strip = await sheet.getByRole("radiogroup").boundingBox();
  const rights = await sheet
    .getByRole("radio")
    .evaluateAll((days) => days.map((day) => day.getBoundingClientRect().right));
  expect(rights).toHaveLength(14);
  for (const right of rights) expect(right).toBeLessThanOrEqual((strip?.x ?? 0) + (strip?.width ?? 0) + 0.5);
});

test("has a Close anyone can see, a full target, ringed in paper on the ground it stands on", async ({ page }) => {
  await openSheet(page);
  const sheet = page.getByRole("dialog", { name: "Pick a date" });
  const close = sheet.getByRole("button", { name: "Close" });
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
  // The design has no focus ring, so it follows the ground: paper on the ink-night above the sheet, never gilt,
  // which on the sheet's paper was 1.86:1.
  expect(await close.evaluate((button) => getComputedStyle(button).outlineColor)).toBe("rgb(233, 228, 216)");
  // And ink on the sheet itself.
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement && getComputedStyle(document.activeElement).outlineColor),
  ).toBe("rgb(22, 35, 58)");
});

// Axe read the date, window and pay steps only; the outcome step's states, where a client is told something went wrong, went unread.
test("the payment's outcomes meet WCAG 2.2 AA: failed, the slot gone back, and confirmed", async ({ page }) => {
  await fakeCheckout(page, "failed");
  await page.clock.install();
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog", { name: "The payment didn’t go through." })).toBeVisible();
  await scanOf(page);

  await page.clock.fastForward("11:00");
  await expect(page.getByRole("dialog", { name: "That time has been released." })).toBeVisible();
  await scanOf(page);
});

test("a confirmed booking meets WCAG 2.2 AA", async ({ page }) => {
  await fakeCheckout(page, "paid");
  await confirmedByRazorpay(page);
  await toPayment(page);
  await page.getByRole("button", { name: "Pay Rs. 2,000" }).click();
  await expect(page.getByRole("dialog", { name: "Confirmed" })).toBeVisible({ timeout: 15_000 });
  await scanOf(page);
});

// Every app project runs with reduced motion, so the sheets' movement was never read by axe or the keyboard.
test.describe("with motion, as most phones have it", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the booking sheet rises and moves between steps, keeps the focus in it, and meets WCAG 2.2 AA", async ({
    page,
  }) => {
    await openSheet(page);
    const dates = page.getByRole("dialog", { name: "Pick a date" });
    await expect(dates).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => dates.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);

    await dates.getByRole("radio").and(page.locator(":enabled")).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    const windows = page.getByRole("dialog", { name: "Pick a time" });
    await expect(windows).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished)));
    await scanOf(page);
    await expect.poll(() => windows.evaluate((sheet) => sheet.contains(document.activeElement))).toBe(true);
  });
});

test("each booking step meets WCAG 2.2 AA", async ({ page }) => {
  const scan = () => scanOf(page);
  await fakeCheckout(page, "paid");
  await openSheet(page);
  await expect(page.getByRole("dialog", { name: "Pick a date" })).toBeVisible();
  await scan();
  await page.getByRole("dialog").getByRole("radio").and(page.locator(":enabled")).first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("dialog", { name: "Pick a time" })).toBeVisible();
  await scan();
  await continueToPayment(page);
  await expect(page.getByRole("dialog", { name: "Pay and confirm" })).toBeVisible();
  await scan();
});

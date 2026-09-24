// The booking sheet's window step, for the tests that go on to pay.
//
// Three technicians serve every test in this suite (e2e/global-setup.ts), and
// the tests that book all reach for the same first free day, so a window the
// sheet offered can be held by another of them before this one asks for it. The
// API then answers `taken` and the sheet says so and offers what is left, which
// is what board C3 asks of it. A client picks another; so does this.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";

/** Board C3's words when the window went while the client was choosing. */
export const TAKEN = "That window has just gone. Pick another.";

/** Picks a free window on the day the sheet is showing, and continues to payment. */
export async function continueToPayment(page: Page): Promise<void> {
  const windows = page.getByRole("dialog", { name: "Pick a window" });
  const pay = page.getByRole("dialog", { name: "Pay and confirm" });
  // Three tries: the day has three windows, and a client would give up on the day too.
  for (let tries = 0; tries < 3; tries += 1) {
    await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
    await windows.getByRole("button", { name: "Continue to payment" }).click();
    const held = await pay.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    );
    if (held) return;
    // Nothing else leaves the sheet on this step, so anything else fails here rather than looping.
    await expect(windows.getByRole("alert")).toHaveText(TAKEN);
  }
  await expect(pay, "three windows in a row went to another client").toBeVisible();
}

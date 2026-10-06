// The booking sheet's window step, for the tests that go on to pay.
//
// Three technicians serve every test in this suite (e2e/global-setup.ts), and
// the tests that book all reach for the same first free day, so a window the
// sheet offered can be held by another of them before this one asks for it. The
// API then answers `taken` and the sheet says so and offers what is left, which
// is what the window picker asks of it. A client picks another; so does this.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";

/** The window picker's words when the window went while the client was choosing. */
export const TAKEN = "That time has just gone. Pick another.";

/** The pay step: "Pay and confirm", or "Confirm" for a visit that costs nothing. */
const PAY_STEP = /^(Pay and confirm|Confirm)$/;

/** Picks a free window on the day the sheet is showing, and continues to the pay step. */
export async function continueToPayment(page: Page): Promise<void> {
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  const pay = page.getByRole("dialog", { name: PAY_STEP });
  // Three tries: the day has three windows, and a client would give up on the day too.
  for (let tries = 0; tries < 3; tries += 1) {
    await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
    // The API's answer decides, however long a busy machine takes to give it: on 1 October 2026 a hold answered
    // after seven seconds, and a five-second wait for the pay step read it as a window gone.
    const answered = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/holds",
      { timeout: 30_000 },
    );
    // "Continue" alone where the day costs nothing, as a free move's does.
    await windows.getByRole("button", { name: /^Continue( to payment)?$/ }).click();
    if ((await answered).ok()) {
      await expect(pay).toBeVisible();
      return;
    }
    // Nothing else leaves the sheet on this step, so anything else fails here rather than looping.
    await expect(windows.getByRole("alert")).toHaveText(TAKEN);
  }
  await expect(pay, "three windows in a row went to another client").toBeVisible();
}

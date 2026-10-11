// The booking sheet's window step, for the tests that go on to pay.
//
// Three technicians serve every test in this suite (e2e/global-setup.ts), and
// the tests that book all reach for the same first free day, so a window the
// sheet offered can be held by another of them before this one asks for it. The
// API then answers `taken` and the sheet says so and offers what is left, which
// is what the window picker asks of it. A client picks another; so does this.

import type { Page, Response } from "@playwright/test";
import { expect } from "../support.ts";

/** The window picker's words when the window went while the client was choosing. */
export const TAKEN = "That time has just gone. Pick another.";

/** The pay step: "Pay and confirm", or "Confirm" for a visit that costs nothing. */
const PAY_STEP = /^(Pay and confirm|Confirm)$/;

const isCall = (method: string, path: string) => (response: Response) =>
  response.request().method() === method && new URL(response.url()).pathname === path;

/**
 * The day's windows, asked for again after a refusal, and drawn. Started before the tap that is refused: a window
 * picked before they are drawn may be one the fresh answer takes away, and the pick goes with it.
 */
export function windowsAskedAgain(page: Page): () => Promise<void> {
  const answered = page.waitForResponse(isCall("GET", "/api/availability"), { timeout: 30_000 }).catch(() => null);
  return async () => {
    await answered;
    await page.evaluate(() => new Promise((drawn) => requestAnimationFrame(() => requestAnimationFrame(drawn))));
  };
}

/** Picks a free window on the day the sheet is showing, and continues to the pay step. */
export async function continueToPayment(page: Page): Promise<void> {
  const windows = page.getByRole("dialog", { name: "Pick a time" });
  const pay = page.getByRole("dialog", { name: PAY_STEP });
  // Three tries: the day has three windows, and a client would give up on the day too.
  for (let tries = 0; tries < 3; tries += 1) {
    await windows.getByRole("radio").and(page.locator(":enabled")).first().click();
    // The API's answer decides, however long a busy machine takes to give it: on 1 October 2026 a hold answered
    // after seven seconds, and a five-second wait for the pay step read it as a window gone.
    const answered = page.waitForResponse(isCall("POST", "/api/holds"), { timeout: 30_000 });
    const redrawn = windowsAskedAgain(page);
    // "Continue" alone where the day costs nothing, as a free move's does.
    await windows.getByRole("button", { name: /^Continue( to payment)?$/ }).click();
    if ((await answered).ok()) {
      await expect(pay).toBeVisible();
      return;
    }
    // Nothing else leaves the sheet on this step, so anything else fails here rather than looping.
    await expect(windows.getByRole("alert")).toHaveText(TAKEN);
    await redrawn();
  }
  await expect(pay, "three windows in a row went to another client").toBeVisible();
}

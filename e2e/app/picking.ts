// The booking sheet's day and time, for the tests that go on to pay.
//
// Three technicians serve every test in this suite (e2e/global-setup.ts). Each
// worker books on a day of its own (toWindows, ./booking-fixtures.ts), but a day
// can fill, and its next free day can be another worker's, so a window the sheet
// offered can be held by another test before this one asks for it. The API then
// answers `taken` and the sheet says so and offers what is left, which is what the
// window picker asks of it. A client picks another; so does this.

import type { Page, Response } from "@playwright/test";
import { expect } from "../support.ts";
import { booking } from "../../apps/app/src/content.ts";

/** The time picker's words when the time went while the client was choosing. */
export const TAKEN = booking.when.gone;

/** The day and time step, by its title: any visit's, a first fit's or replacement's, or a move's. */
export const WHEN_STEP = new RegExp(`^(${booking.when.title}|${booking.when.titleDate}|${booking.when.titleMove})$`);

/** The day and time step's open times, apart from its days, which are radios too. */
export const OPEN_TIMES = 'input[name="booking-time"]:enabled';

/** The review's count: "We’re holding this time for you for 9:42". */
export const HELD_FOR = new RegExp(`^${booking.pay.holding}\\d+:\\d\\d$`);

/** The day chosen, and the time chosen on it. */
export const CHOSEN_DAY = 'input[name="booking-date"]:checked';
export const CHOSEN_TIME = 'input[name="booking-time"]:checked';

/** A day's name, as the strip says it before how many of its times are left: "Thursday 22 October, 3 left". */
export const dayNamed = (day: string): RegExp => new RegExp(`^${day}, `);

/** The day and time step's open days. */
export const OPEN_DAYS = 'input[name="booking-date"]:enabled';

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

/** Picks a free time on the day the sheet is showing, and continues to the review. */
export async function continueToPayment(page: Page): Promise<void> {
  const windows = page.getByRole("dialog", { name: WHEN_STEP });
  const pay = page.getByRole("dialog", { name: booking.pay.title });
  // Three tries: a client would give up on the day too.
  for (let tries = 0; tries < 3; tries += 1) {
    await windows.locator(OPEN_TIMES).first().click();
    // The API's answer decides, however long a busy machine takes to give it: a hold can answer after seven seconds,
    // which a five-second wait for the pay step would read as a window gone.
    const answered = page.waitForResponse(isCall("POST", "/api/holds"), { timeout: 30_000 });
    const redrawn = windowsAskedAgain(page);
    await windows.getByRole("button", { name: booking.when.continue, exact: true }).click();
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

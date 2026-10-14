// A write pressed twice before the console can draw in between, as a double-click or an impatient second press is:
// it reaches the API once (docs/decisions/0058-one-tap-per-intent.md).

import type { Locator } from "@playwright/test";

/** Presses `button` twice in one go, so the second press lands before the first has disabled anything. */
export async function pressTwice(button: Locator): Promise<void> {
  await button.evaluate((element: HTMLElement) => {
    element.click();
    element.click();
  });
}

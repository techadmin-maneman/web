// Small reads every flow makes of a screen, by what a person sees: a part of the page by its name, whichever role
// draws it (a heading, a labelled region, a dialog), and the page's own status line.

import { expect, type Locator, type Page } from "@playwright/test";

/** A part of the page named `name`: its heading, a region or a dialog of that name. */
export function part(page: Page | Locator, name: string | RegExp): Locator {
  return page
    .getByRole("heading", { name })
    .or(page.getByRole("region", { name }))
    .or(page.getByRole("dialog", { name }))
    .first();
}

/** Waits for a part of the page named `name`. */
export async function sees(page: Page | Locator, name: string | RegExp): Promise<void> {
  await expect(part(page, name)).toBeVisible();
}

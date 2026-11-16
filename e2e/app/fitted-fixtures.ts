// What the fitted client's browser tests share (fitted*.e2e.ts): the app's tabs.

import type { Page } from "@playwright/test";

/** A tab by its name, which a count may follow ("Visits, 2 open issues"), and never another tab whose count says it. */
export const tab = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { name: new RegExp(`^${name}(,|$)`) });

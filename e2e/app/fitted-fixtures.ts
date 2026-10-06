// What the fitted client's browser tests share (fitted*.e2e.ts): the app's tabs.

import type { Page } from "@playwright/test";

export const tab = (page: Page, name: string) => page.getByRole("navigation").getByRole("link", { name });

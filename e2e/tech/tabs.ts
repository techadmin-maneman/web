// The tab bar and Me, as the technician reaches them: a tab by its name, and signing out from Me's sheet.

import type { Page } from "@playwright/test";
import * as techCopy from "../../apps/tech/src/content.ts";

/** A tab, by its name, in the bar at the foot of the top-level screens. */
export const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: techCopy.tabs.label }).getByRole("link", { name, exact: true });

/** Me's Sign out, which opens the sheet that asks first. */
export async function askToSignOut(page: Page): Promise<void> {
  await tab(page, techCopy.tabs.me).click();
  await page.getByRole("button", { name: techCopy.me.signOut, exact: true }).click();
}

/** Signs out from Me, nothing being left unsent. */
export async function signOut(page: Page): Promise<void> {
  await askToSignOut(page);
  await page.getByRole("dialog").getByRole("button", { name: techCopy.me.signOut, exact: true }).click();
}

/** What has not reached us, from Me's Pending uploads. */
export async function openPending(page: Page): Promise<void> {
  await tab(page, techCopy.tabs.me).click();
  await page.getByRole("link", { name: new RegExp(`^${techCopy.me.pending}`) }).click();
}

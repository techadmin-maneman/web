// What the app's profile browser tests share (profile*.e2e.ts): the app opened on a signed-in client, on the profile's
// list, or on the one of its pages a test is about.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { signIn } from "./signed-in.ts";
import { profileMenu, profilePages, titles } from "../../apps/app/src/content.ts";

type ProfilePage = "address" | "privacy" | "account";

export async function loggedIn(page: Page, where?: ProfilePage): Promise<string> {
  const mobile = await signIn(page);
  await page.getByRole("link", { name: titles.profile }).click();
  await expect(page.getByRole("link", { name: profileMenu.account })).toBeVisible();
  if (where !== undefined) {
    await page.getByRole("link", { name: profileMenu[where] }).click();
    await expect(page.getByRole("heading", { level: 1, name: profilePages[where] })).toBeVisible();
  }
  return mobile;
}

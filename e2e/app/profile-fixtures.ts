// What the app's profile browser tests share (profile*.e2e.ts): the app opened on a signed-in client.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { signIn } from "./signed-in.ts";

export async function loggedIn(page: Page): Promise<string> {
  const mobile = await signIn(page);
  await page.getByRole("link", { name: "Your profile" }).click();
  await expect(page.getByRole("heading", { name: "Where we come" })).toBeVisible();
  return mobile;
}

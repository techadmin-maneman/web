// A screen of the client app held at a phone's sizes (./large-text.e2e.ts, ./large-text-sheets.e2e.ts): 390 and 360
// px, and 360 with its text at 130% (docs/prompts/client-redesign.md, "Acceptance"). Nothing spills out of its box,
// as a name running into the next, and nothing scrolls sideways, the page itself included, but a row made to, which
// hides its bar: the photographs' angles and the booking's days. Larger text is drawn as the browser's zoom draws it,
// which grows the page's type and its boxes alike: the stricter of the two ways a phone enlarges text.

import type { Page } from "@playwright/test";
import { expect } from "../support.ts";
import { holds, named } from "../holds.ts";
import { fittedClient } from "./fitted.ts";
import { logIn } from "./signed-in.ts";

/** Each size a screen is held at: its width, and how much its text is enlarged. */
export const SIZES = [
  { width: 390, zoom: 1 },
  { width: 360, zoom: 1 },
  { width: 360, zoom: 1.3 },
] as const;

export type Size = (typeof SIZES)[number];

export { holds, named };

/** Signed in as the fitted client, before any page is asked for: one asked sooner is the sign-in screen. */
export async function signedIn(page: Page) {
  const fitted = fittedClient();
  await logIn(page, fitted.mobile);
  await expect(page.getByRole("navigation").first()).toBeVisible();
  return fitted;
}

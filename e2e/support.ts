// Shared helpers for the browser tests.

import type { Page } from "@playwright/test";

/** Cloudflare's dummy token: the local and staging APIs accept it (docs/turnstile.md). */
export const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Replaces Cloudflare's Turnstile script with one that hands out the dummy
 * token, so no test depends on reaching Cloudflare from the browser.
 */
export async function fakeTurnstile(page: Page): Promise<void> {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `(() => {
        let options;
        const issue = () => setTimeout(() => options.callback(${JSON.stringify(DUMMY_TOKEN)}), 20);
        window.turnstile = {
          render(container, given) { options = given; issue(); return "fake"; },
          reset() { issue(); },
        };
      })();`,
    }),
  );
}

/** Opens a page and waits for its islands to hydrate: Astro drops [ssr] once one has. */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
}

/** A random mobile number, so the API's per-number daily limit never trips. */
export function randomMobile(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

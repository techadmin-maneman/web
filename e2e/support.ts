// Shared helpers for the browser tests.

import type { Page } from "@playwright/test";
import sharp from "sharp";
import { drawnHead, HEAD_HEIGHT, HEAD_WIDTH, type Rgb } from "../test/node/drawn-head.ts";

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

/** A drawn head with brown hair, as a JPEG for the try-on's file input: never a photograph of anyone. */
export async function drawnHeadPhoto(hair: Rgb = [49, 37, 29]) {
  const raw = { width: HEAD_WIDTH, height: HEAD_HEIGHT, channels: 4 } as const;
  const buffer = await sharp(Buffer.from(drawnHead(hair).buffer), { raw })
    .jpeg({ quality: 95 })
    .toBuffer();
  return { name: "drawn-head.jpg", mimeType: "image/jpeg", buffer };
}

/** A 1 × 1 JPEG: too small for the API. */
export const TINY_JPEG = {
  name: "tiny.jpg",
  mimeType: "image/jpeg",
  buffer: Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  ),
};

/** Walks the try-on from a chosen photograph to pressing Generate, with the stage and look as v2 offers them. */
export async function throughToGenerate(page: Page): Promise<void> {
  const reach = (screen: string) => page.locator(`[data-screen="${screen}"]`).waitFor();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await drawnHeadPhoto());
  await reach("consent");
  await page.getByText("I understand, and I agree to my photograph being used this way.").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await reach("stage");
  await page.getByRole("button", { name: "Continue" }).click();
  await reach("looks");
  await page.getByText("Light density").first().click();
  await page.getByRole("button", { name: "Generate the simulation" }).click();
}

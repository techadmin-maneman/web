// Shared helpers for the browser tests, and the `test` they all use: it fails
// any test in which the page broke the site's content security policy, and
// gives every client app test the stand-in Turnstile its first screen needs.

import { test as base, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { drawnHead, HEAD_HEIGHT, HEAD_WIDTH, type Rgb } from "../test/node/drawn-head.ts";
import { contractErrors, type Surface } from "./contract.ts";

export { expect };

/** The API document each project's pages are answered under. */
const SURFACES: Readonly<Record<string, Surface>> = {
  "390": "public",
  "1440": "public",
  app: "client",
  ops: "ops",
  tech: "tech",
  "tech-ios": "tech",
  "tech-live": "tech",
};

const OUTSIDE_CONTRACT = "outside-contract";
const BODY_WAIT_MS = 5_000;

/**
 * Lets the running test answer each route ("GET /api/payments 200") outside the API's contract, on purpose: a body the
 * page cannot draw, or an older API's answer.
 */
export function outsideContract(...routes: string[]): void {
  for (const route of routes) test.info().annotations.push({ type: OUTSIDE_CONTRACT, description: route });
}

export const test = base.extend<{ contentSecurityPolicy: undefined; appTurnstile: undefined; apiContract: undefined }>({
  // Every JSON answer the page had from /api/*, a fake's or the local mm-api's, held to the committed OpenAPI
  // document (e2e/contract.ts): a fake that drifts from the API, or a route that answers what it never documented,
  // fails the test it shows in.
  apiContract: [
    async ({ page }, use, testInfo) => {
      const surface = SURFACES[testInfo.project.name];
      const answers: Promise<string[]>[] = [];
      if (surface !== undefined) {
        // Only answers that arrived whole. Even then Chromium can lose a body the page has finished with, and never
        // hand it over: one not read within BODY_WAIT_MS is let go.
        page.on("requestfinished", (request) => {
          const { pathname } = new URL(request.url());
          if (!pathname.startsWith("/api/")) return;
          const read = request.response().then(
            async (response) => {
              if (response === null) return [];
              if (!(response.headers()["content-type"] ?? "").includes("application/json")) return [];
              const body: unknown = await response.json().catch(() => undefined);
              if (body === undefined) return [];
              return contractErrors(surface, request.method(), pathname, response.status(), body);
            },
            // The page closed before its answer could be read.
            () => [],
          );
          const lost = new Promise<string[]>((resolve) =>
            setTimeout(() => {
              resolve([]);
            }, BODY_WAIT_MS),
          );
          answers.push(Promise.race([read, lost]));
        });
      }
      await use(undefined);
      const meant = testInfo.annotations
        .filter(({ type }) => type === OUTSIDE_CONTRACT)
        .map(({ description }) => `${description ?? ""}:`);
      const errors = (await Promise.all(answers))
        .flat()
        .filter((error) => !meant.some((route) => error.startsWith(route)));
      expect(errors, "the page was answered outside the API's contract").toEqual([]);
    },
    { auto: true },
  ],
  contentSecurityPolicy: [
    async ({ page }, use) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Content Security Policy")) {
          violations.push(message.text());
        }
      });
      await use(undefined);
      expect(violations, "the page broke the content security policy").toEqual([]);
    },
    { auto: true },
  ],
  appTurnstile: [
    async ({ page }, use, testInfo) => {
      if (testInfo.project.name === "app") await fakeTurnstile(page);
      await use(undefined);
    },
    { auto: true },
  ],
});

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
          remove() {},
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

/** Walks the try-on from a chosen photograph to the gate, with the stage and look as v2 offers them. */
export async function throughToGate(page: Page): Promise<void> {
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
  await page.getByRole("button", { name: "Continue" }).click();
  await reach("gate");
}

/** The WhatsApp code the local API sends every number (OTP_FIXED_CODE); a mocked API takes any. */
export const NUMBER_CODE = "246810";
/** The code's ID a mocked API answers with. */
export const NUMBER_CODE_ID = "33333333-3333-4333-8333-333333333333";

/** A mocked API's WhatsApp code, which proves a number before /book's one visit or /try's gate acts on it. */
export async function mockNumberCode(page: Page): Promise<void> {
  await page.route("**/api/number-code", (route) => route.fulfill({ status: 202, json: { code_id: NUMBER_CODE_ID } }));
  await page.route("**/api/number-code/verify", (route) => route.fulfill({ json: { verified: true } }));
}

/** Enters the WhatsApp code sent to the number, and presses the form's button, which now confirms it. */
export async function enterNumberCode(page: Page, confirm: string): Promise<void> {
  await page.getByLabel("WhatsApp code").fill(NUMBER_CODE);
  await page.getByRole("button", { name: confirm }).click();
}

/** Fills in the gate, which the look is sent to, and sends it, entering the WhatsApp code sent to the number. */
export async function sendFromGate(page: Page, mobile: string, name = "Test Visitor"): Promise<void> {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Mobile").fill(mobile);
  await page.getByRole("button", { name: "Send my look" }).click();
  await enterNumberCode(page, "Confirm and send my look");
}

/** Every command the page queued for the analytics tags (GA's dataLayer), as arrays. */
export function analyticsCommands(page: Page): Promise<unknown[][]> {
  return page.evaluate(() =>
    ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((entry) => Array.from(entry)),
  );
}

/** The analytics events the page sent, with their parameters. */
export async function analyticsEvents(page: Page): Promise<[string, Record<string, unknown>][]> {
  const commands = await analyticsCommands(page);
  return commands
    .filter(([command]) => command === "event")
    .map(([, name, parameters]) => [String(name), (parameters ?? {}) as Record<string, unknown>]);
}

/**
 * Fails if a name, a number or an image reference reached the analytics
 * tags, or the address any tag would read.
 */
export async function expectNoPersonalData(page: Page, personal: readonly string[]): Promise<void> {
  const sent = JSON.stringify(await analyticsCommands(page)) + page.url();
  for (const value of [...personal, "blob:", "/api/result", "/api/tryon/upload"]) {
    expect(sent, `analytics carried "${value}"`).not.toContain(value);
  }
}

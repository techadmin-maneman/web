// The console's kit (apps/ops/src/kit/KitScreen.tsx), shot whole after the ops pairs (docs/fidelity-method.md, "The
// kit"): every shared part in its states, on paper and on the ink. It has no board to pair with, and calls no API.
//
//   npm run build:ops -- --env local && npm run fidelity:ops

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { STILL } from "../lib/fidelity.ts";
import { serveDirectory } from "../lib/static-server.ts";

const OUT = resolve("docs/fidelity/ops");
const server = await serveDirectory(resolve("apps/ops/dist/local"), 4317, undefined, { spa: true });
const browser = await chromium.launch();
try {
  // The console's policy refuses an inline style, and the run adds one that stills the motion.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4317/_kit");
  await page.addStyleTag({ content: STILL });
  await page.getByRole("heading", { level: 1, name: "The kit" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, "kit.png"), fullPage: true });
  console.log(`fidelity: the kit, written to ${resolve(OUT, "kit.png")}`);
} finally {
  await browser.close();
  server.close();
}

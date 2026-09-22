// What the fidelity harnesses share (docs/fidelity-method.md): the design's
// libraries answered from node_modules, the style that stills a page, and the
// pairing of two screenshots, the design on the left.

import { mkdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import sharp from "sharp";

/** The design fetches these from unpkg; the same versions are in node_modules. */
const LIBRARIES: Readonly<Record<string, string>> = {
  "https://unpkg.com/react@18.3.1/umd/react.production.min.js": "node_modules/react/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js":
    "node_modules/react-dom/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js": "node_modules/@babel/standalone/babel.min.js",
};

export async function routeDesignLibraries(page: Page): Promise<void> {
  await page.route("https://unpkg.com/**", async (route) => {
    const file = LIBRARIES[route.request().url()];
    if (file === undefined) return route.abort();
    return route.fulfill({
      body: readFileSync(file),
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
}

/** No smooth scrolling, transition, animation or caret, so a screenshot shows the settled page. */
export const STILL =
  "html { scroll-behavior: auto !important; } *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }";

/** The two screenshots side by side, the design on the left, written to <dir>/<name>.jpg. */
export async function pair(dir: string, width: number, name: string, design: Buffer, built: Buffer): Promise<void> {
  const scale = width > 1000 ? 0.5 : 1;
  const [left, right] = await Promise.all(
    [design, built].map(async (image) => {
      const meta = await sharp(image).metadata();
      const scaled = await sharp(image)
        .resize({ width: Math.round(meta.width * scale) })
        .toBuffer({ resolveWithObject: true });
      return scaled;
    }),
  );
  if (left === undefined || right === undefined) throw new Error("screenshot missing");
  const gap = 16;
  const label = 28;
  const height = Math.max(left.info.height, right.info.height) + label;
  const total = left.info.width + gap + right.info.width;
  const caption = Buffer.from(
    `<svg width="${String(total)}" height="${String(label)}"><style>text{font:14px sans-serif;fill:#5F5851}</style>` +
      `<text x="4" y="19">design · ${name} · ${String(width)} px</text>` +
      `<text x="${String(left.info.width + gap + 4)}" y="19">built</text></svg>`,
  );
  mkdirSync(dir, { recursive: true });
  await sharp({ create: { width: total, height, channels: 3, background: "#ffffff" } })
    .composite([
      { input: caption, top: 0, left: 0 },
      { input: left.data, top: label, left: 0 },
      { input: right.data, top: label, left: left.info.width + gap },
    ])
    .jpeg({ quality: 70 })
    .toFile(`${dir}/${name}.jpg`);
  console.log(`  ${String(width)} ${name}`);
}

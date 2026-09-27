// What makes the client app installable and able to open offline
// (docs/decisions/0043-client-app.md): the manifest and icons, drawn from the
// brand kit at build time, and the list of files the service worker keeps
// (apps/app/sw/sw.ts), with a version that changes whenever one of them does.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { colourOf } from "../../packages/brand/colours.ts";
import type { Plugin } from "vite";

const FAVICON = `${import.meta.dirname}/../../design/brand/favicon-32.svg`;
const TOKENS = `${import.meta.dirname}/../../packages/brand/tokens.css`;

/** A colour from tokens.css, so the icons and the manifest use the app's one set of values. */
export function token(name: string, tokens = readFileSync(TOKENS, "utf8")): string {
  return colourOf(name, tokens);
}

/**
 * The favicon drawing on ink, as the brand kit's README asks for home-screen
 * icons, at two thirds of the icon's width, as the site's touch icon is. A
 * maskable icon may be cropped to a circle 80% wide, so its crown is smaller.
 */
export const ICONS = [
  { file: "icon-192.png", size: 192, art: 128, purpose: "any" },
  { file: "icon-512.png", size: 512, art: 340, purpose: "any" },
  { file: "icon-maskable-512.png", size: 512, art: 256, purpose: "maskable" },
  { file: "apple-touch-icon.png", size: 180, art: 120, purpose: null },
] as const;

type Icon = (typeof ICONS)[number];

async function draw(icon: Icon, ink: string): Promise<Buffer> {
  const art = await sharp(readFileSync(FAVICON), { density: 600 }).resize({ width: icon.art }).png().toBuffer();
  return sharp({ create: { width: icon.size, height: icon.size, channels: 4, background: ink } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
}

export function manifest(ink: string) {
  return {
    name: "Mane Man",
    short_name: "Mane Man",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "en-IN",
    background_color: ink,
    theme_color: ink,
    // The Apple touch icon is linked from index.html instead.
    icons: ICONS.flatMap((icon) =>
      icon.purpose === null
        ? []
        : [
            {
              src: `/${icon.file}`,
              sizes: `${String(icon.size)}x${String(icon.size)}`,
              type: "image/png",
              purpose: icon.purpose,
            },
          ],
    ),
  };
}

/**
 * Fonts the app never draws with, which a phone need not keep: the extended
 * Latin subsets, fetched only for a character outside Latin, and the rupee,
 * since the app writes amounts as "Rs.". A name that needs one is drawn from
 * the network, or offline in the phone's own font.
 */
const NEVER_DRAWN = /-(latin-ext|rupee)-/;

/** The files the service worker keeps: every file of the build, with the app itself kept as "/". */
export function precacheList(fileNames: readonly string[]): string[] {
  const files = fileNames.filter((name) => name !== "index.html" && name !== "sw.js" && !NEVER_DRAWN.test(name));
  return ["/", ...[...new Set(files)].sort().map((name) => `/${name}`)];
}

/** Changes whenever any kept file does, so the service worker installs afresh and drops the old files. */
export function version(files: readonly { name: string; content: string | Uint8Array }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(file.name).update(file.content);
  }
  return hash.digest("hex").slice(0, 12);
}

export function pwa(): Plugin {
  return {
    name: "mm-pwa",
    apply: "build",
    async generateBundle(_options, bundle) {
      const ink = token("--ink");
      const added = [
        ...(await Promise.all(ICONS.map(async (icon) => ({ name: icon.file, content: await draw(icon, ink) })))),
        { name: "manifest.webmanifest", content: `${JSON.stringify(manifest(ink), null, 2)}\n` },
      ];
      for (const file of added) this.emitFile({ type: "asset", fileName: file.name, source: file.content });

      const worker = bundle["sw.js"];
      if (worker?.type !== "chunk" || !/\bMM_PRECACHE\b/.test(worker.code) || !/\bMM_VERSION\b/.test(worker.code)) {
        throw new Error("the build has no sw.js waiting for its file list");
      }
      const built = Object.values(bundle)
        .filter((item) => item.fileName !== "sw.js")
        .map((item) => ({ name: item.fileName, content: item.type === "chunk" ? item.code : item.source }));
      const kept = [...built, ...added];
      worker.code = worker.code
        .replace(/\bMM_PRECACHE\b/g, JSON.stringify(precacheList(kept.map((file) => file.name))))
        .replace(/\bMM_VERSION\b/g, JSON.stringify(version(kept)));
    },
  };
}

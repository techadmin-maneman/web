// What makes an app installable and able to open offline, for the client app and the technician app alike
// (docs/decisions/0043-client-app.md, 0053-the-technician-app-offline.md): the manifest, the home-screen icons and
// the tab's favicons, drawn from the brand kit at build time, and the list of files the service worker keeps, with a
// version that changes whenever one of them does. Each app gives its own identity (apps/app/pwa.ts, apps/tech/pwa.ts);
// its service worker (apps/*/sw/sw.ts) waits for MM_PRECACHE and MM_VERSION, which this writes in.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";
import { colourOf } from "../brand/colours.ts";
import { onGround } from "../brand/images.ts";

const BRAND = `${import.meta.dirname}/../../design/brand`;
const TOKENS = `${import.meta.dirname}/../brand/tokens.css`;

/** An app as a home screen and a tab show it. */
export interface PwaApp {
  readonly name: string;
  /** Under the icon, where a launcher has room for about twelve characters. */
  readonly shortName: string;
  /** What an install prompt says the app is. */
  readonly description: string;
  /** The tokens.css colour the icons, the splash and the bar are drawn on, as the app's own ground is. */
  readonly ground: "--ink" | "--ink-deep";
  /** For an app held in one hand at work, which a turned phone should not rearrange. */
  readonly orientation?: "portrait";
}

/** A colour from tokens.css, so the icons and the manifest use the apps' one set of values. */
export function token(name: string, tokens = readFileSync(TOKENS, "utf8")): string {
  return colourOf(name, tokens);
}

/**
 * The favicon drawing on the app's ground, as the brand kit's README asks for home-screen icons, at two thirds of the
 * icon's width, as the site's touch icon is. A maskable icon may be cropped to a circle 80% wide, so its crown is
 * smaller. The tab's favicons are the site's: the 16 px one is the kit's silhouette cut.
 */
export const ICONS = [
  { file: "icon-192.png", size: 192, art: 128, purpose: "any", drawing: "favicon-32.svg" },
  { file: "icon-512.png", size: 512, art: 340, purpose: "any", drawing: "favicon-32.svg" },
  { file: "icon-maskable-512.png", size: 512, art: 256, purpose: "maskable", drawing: "favicon-32.svg" },
  { file: "apple-touch-icon.png", size: 180, art: 120, purpose: null, drawing: "favicon-32.svg" },
  { file: "favicon-32.png", size: 32, art: 28, purpose: null, drawing: "favicon-32.svg" },
  { file: "favicon-16.png", size: 16, art: 14, purpose: null, drawing: "favicon-16.svg" },
] as const;

export function manifest(app: PwaApp, ground: string) {
  return {
    name: app.name,
    short_name: app.shortName,
    description: app.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    ...(app.orientation === undefined ? {} : { orientation: app.orientation }),
    lang: "en-IN",
    background_color: ground,
    theme_color: ground,
    // The Apple touch icon and the favicons are linked from index.html instead.
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
 * Fonts neither app draws with, which a phone need not keep: the extended Latin subsets, fetched only for a character
 * outside Latin that the apps' own words never use, and the rupee, since the client app writes amounts as "Rs." and
 * none reaches the technician's. A client's name that needs one is drawn from the network, or offline in the phone's
 * own font.
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

export function pwa(app: PwaApp): Plugin {
  return {
    name: "mm-pwa",
    apply: "build",
    async generateBundle(_options, bundle) {
      const ground = token(app.ground);
      const drawn = await Promise.all(
        ICONS.map(async (icon) => ({
          name: icon.file,
          content: await onGround(
            readFileSync(`${BRAND}/${icon.drawing}`, "utf8"),
            { width: icon.size, height: icon.size },
            icon.art,
            ground,
          ),
        })),
      );
      const added = [
        ...drawn,
        { name: "manifest.webmanifest", content: `${JSON.stringify(manifest(app, ground), null, 2)}\n` },
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

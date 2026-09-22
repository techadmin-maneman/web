// The client app's manifest and the service worker's file list (apps/app/pwa.ts),
// and the names the app and its service worker must agree on.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS, manifest, precacheList, token, version } from "../../apps/app/pwa.ts";

describe("the client app's manifest", () => {
  const ink = token("--ink");

  it("takes its colours from the brand's ink", () => {
    expect(ink).toBe("#16233a");
    expect(manifest(ink)).toMatchObject({ background_color: ink, theme_color: ink });
  });

  it("opens the whole app, standalone, from its root", () => {
    expect(manifest(ink)).toMatchObject({
      name: "Mane Man",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("lists the 192 and 512 icons and a maskable one, and leaves the Apple touch icon to index.html", () => {
    expect(manifest(ink).icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
    expect(readFileSync("apps/app/index.html", "utf8")).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    );
  });

  it("keeps a maskable icon's crown inside the circle a launcher may crop it to", () => {
    const maskable = ICONS.find((icon) => icon.purpose === "maskable");
    // The favicon drawing is 64 by 44.3: its corners must sit within a circle 80% of the icon wide.
    const art = maskable?.art ?? Infinity;
    expect(Math.hypot(art, (art * 44.3) / 64)).toBeLessThan(0.8 * (maskable?.size ?? 0));
  });
});

describe("the service worker's files", () => {
  it("keeps the app as / and every other file of the build, but not index.html or itself", () => {
    expect(precacheList(["index.html", "sw.js", "assets/index-a1.js", "icon-192.png", "assets/index-b2.css"])).toEqual([
      "/",
      "/assets/index-a1.js",
      "/assets/index-b2.css",
      "/icon-192.png",
    ]);
  });

  it("has a version that changes with any file, and not with their order", () => {
    const files = [
      { name: "assets/index-a1.js", content: "one" },
      { name: "manifest.webmanifest", content: "two" },
    ];
    expect(version(files)).toMatch(/^[0-9a-f]{12}$/);
    expect(version([...files].reverse())).toBe(version(files));
    const changed = [
      { name: "assets/index-a1.js", content: "ONE" },
      { name: "manifest.webmanifest", content: "two" },
    ];
    expect(version(changed)).not.toBe(version(files));
  });

  it("names the kept Home and its offline mark as the app does", () => {
    const worker = readFileSync("apps/app/sw/sw.ts", "utf8");
    const app = readFileSync("apps/app/src/api.ts", "utf8");
    for (const name of ['"mm-app-home"', '"Mm-Served-From"']) {
      expect(worker).toContain(name);
      expect(app).toContain(name);
    }
  });
});

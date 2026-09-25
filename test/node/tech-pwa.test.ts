// The technician app's manifest and icons (apps/tech/sw-build.ts).
//
// They exist for one reason: on an iPhone the home screen is where the offline
// store is safe. A web app added to it is exempt from Safari's seven-day cap on
// script-writable storage, and being one is the heuristic WebKit grants
// persistent storage on. Neither holds for a bookmark that opens in Safari, and
// only `display: standalone` tells the two apart.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS, manifest, precacheList, token, version } from "../../apps/tech/sw-build.ts";

describe("the technician app's manifest", () => {
  const ink = token("--ink-deep");

  it("takes its colour from the ink the app is drawn on", () => {
    expect(ink).toBe("#0e1728");
    expect(readFileSync("apps/tech/index.html", "utf8")).toContain(`<meta name="theme-color" content="${ink}" />`);
    expect(manifest(ink)).toMatchObject({ background_color: ink, theme_color: ink });
  });

  it("opens the whole app standalone, which is what makes an iPhone keep its store", () => {
    expect(manifest(ink)).toMatchObject({
      name: "Mane Man technician",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
  });

  it("is linked from the page, with the Apple touch icon and the flag an older iPhone reads", () => {
    const html = readFileSync("apps/tech/index.html", "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });

  it("lists the launcher's icons and leaves the Apple touch icon to index.html", () => {
    expect(manifest(ink).icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
    expect(ICONS.map((icon) => icon.file)).toContain("apple-touch-icon.png");
  });
});

describe("what the service worker keeps", () => {
  it("keeps the app as / and every other file by its path, with no index.html or worker of its own", () => {
    expect(precacheList(["index.html", "sw.js", "assets/index-abc.js", "manifest.webmanifest"])).toEqual([
      "/",
      "/assets/index-abc.js",
      "/manifest.webmanifest",
    ]);
  });

  it("leaves out the fonts the app never draws with: extended Latin, and the rupee", () => {
    const built = [
      "assets/instrument-sans-latin-400-normal-a.woff2",
      "assets/instrument-sans-latin-ext-400-normal-b.woff2",
      "assets/eb-garamond-latin-ext-400-normal-c.woff2",
      "assets/eb-garamond-rupee-400-d.woff2",
    ];
    expect(precacheList(built)).toEqual(["/", "/assets/instrument-sans-latin-400-normal-a.woff2"]);
  });

  it("changes its version when any kept file changes, so a new build installs afresh", () => {
    const before = version([{ name: "a.js", content: "one" }]);
    expect(version([{ name: "a.js", content: "one" }])).toBe(before);
    expect(version([{ name: "a.js", content: "two" }])).not.toBe(before);
  });
});

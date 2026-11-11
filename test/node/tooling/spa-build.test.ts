// What an app's 150 KB budget counts (scripts/lib/spa-build.ts): the JavaScript a first visit fetches.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { firstLoadScripts } from "../../../scripts/lib/spa-build.ts";

const PAGE = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-a1.js"></script>
<link rel="modulepreload" crossorigin href="/assets/shared-b2.js">
<link rel="stylesheet" crossorigin href="/assets/index-c3.css">
</head><body><div id="root"></div></body></html>`;

let dist = "";

let root = "";

/**
 * A built app: its page, the scripts it loads, a section loaded when it opens, a local build's parts page, and a
 * service worker if asked; built for the environment named.
 */
function built(page: string, withWorker: boolean, environment = "staging"): string {
  root = mkdtempSync(join(tmpdir(), "spa-build-"));
  dist = join(root, environment);
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), page);
  for (const file of ["index-a1.js", "shared-b2.js", "SettingsScreen-d4.js", "PartsScreen-e5.js"]) {
    writeFileSync(join(dist, "assets", file), "export {};");
  }
  if (withWorker) writeFileSync(join(dist, "sw.js"), "self;");
  return dist;
}

const names = (files: readonly string[]) => files.map((file) => file.slice(dist.length + 1)).sort();

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the JavaScript a first visit fetches", () => {
  it("is what the page loads and preloads, not a section loaded when it opens, where there is no service worker", () => {
    expect(names(firstLoadScripts(built(PAGE, false)))).toEqual(["assets/index-a1.js", "assets/shared-b2.js"]);
  });

  it("is every script, and the worker, where a service worker precaches them all", () => {
    expect(names(firstLoadScripts(built(PAGE, true)))).toEqual([
      "assets/PartsScreen-e5.js",
      "assets/SettingsScreen-d4.js",
      "assets/index-a1.js",
      "assets/shared-b2.js",
      "sw.js",
    ]);
  });

  // The parts page a local build adds is never served to a phone (apps/tech/src/main.tsx); any other build counts it.
  it("leaves out a local build's parts page, and only a local build's", () => {
    expect(names(firstLoadScripts(built(PAGE, true, "local")))).toEqual([
      "assets/SettingsScreen-d4.js",
      "assets/index-a1.js",
      "assets/shared-b2.js",
      "sw.js",
    ]);
  });

  it("refuses a page it finds no script in, rather than count nothing", () => {
    expect(() => firstLoadScripts(built("<html><body></body></html>", false))).toThrow(/loads no script/);
  });
});

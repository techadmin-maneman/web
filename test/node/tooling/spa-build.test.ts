// What an app's budgets count (scripts/lib/spa-build.ts): the JavaScript a first visit fetches before its first screen
// draws, and everything a service worker keeps.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { firstLoadScripts, precachedScripts } from "../../../scripts/lib/spa-build.ts";

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

  // A phone app counted every script its worker keeps, so splitting it to draw its first screen sooner only grew it.
  it("is what the page loads, a service worker or none, and not what the worker fetches after", () => {
    expect(names(firstLoadScripts(built(PAGE, true)))).toEqual(["assets/index-a1.js", "assets/shared-b2.js"]);
  });
});

describe("what a service worker keeps", () => {
  it("is every script, and the worker; nothing where there is no worker", () => {
    expect(names(precachedScripts(built(PAGE, true)))).toEqual([
      "assets/PartsScreen-e5.js",
      "assets/SettingsScreen-d4.js",
      "assets/index-a1.js",
      "assets/shared-b2.js",
      "sw.js",
    ]);
    expect(precachedScripts(built(PAGE, false))).toEqual([]);
  });

  // The parts page a local build adds is never served to a phone (apps/tech/src/main.tsx); any other build counts it.
  it("leaves out a local build's parts page, and only a local build's", () => {
    expect(names(precachedScripts(built(PAGE, true, "local")))).toEqual([
      "assets/SettingsScreen-d4.js",
      "assets/index-a1.js",
      "assets/shared-b2.js",
      "sw.js",
    ]);
  });
});

describe("the section a first visit opens on", () => {
  // The console's first load counted index.html's scripts alone, while every first visit opens Today at once.
  it("counts the section a first visit opens on, with what it and the page import, and not what loads later", () => {
    const dist = built(PAGE, false);
    writeFileSync(join(dist, "assets", "shared-b2.js"), 'import{a as b}from"./base-c3.js";export{};');
    writeFileSync(join(dist, "assets", "base-c3.js"), "export const a=1;");
    writeFileSync(join(dist, "assets", "TodayScreen-f6.js"), 'import"./RowStep-g7.js";export{};');
    writeFileSync(join(dist, "assets", "RowStep-g7.js"), 'const d=()=>import("./Drawer-h8.js");export{d};');
    writeFileSync(join(dist, "assets", "Drawer-h8.js"), "export{};");
    expect(names(firstLoadScripts(dist, "TodayScreen"))).toEqual([
      "assets/RowStep-g7.js",
      "assets/TodayScreen-f6.js",
      "assets/base-c3.js",
      "assets/index-a1.js",
      "assets/shared-b2.js",
    ]);
  });

  it("refuses a section to open on that it cannot find one chunk of", () => {
    expect(() => firstLoadScripts(built(PAGE, false), "TodayScreen")).toThrow(/0 chunks named TodayScreen/);
  });

  it("refuses a page it finds no script in, rather than count nothing", () => {
    expect(() => firstLoadScripts(built("<html><body></body></html>", false))).toThrow(/loads no script/);
  });
});

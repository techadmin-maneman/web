// Every colour, size and space on the site comes from packages/brand/tokens.css:
// no component writes a raw colour, px, vw or em value, and every token a
// component uses is defined there. The site does not use the Phase 2 layer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rawValues } from "../raw-values.ts";

const SOURCE = "site/src";
const TOKENS = "packages/brand/tokens.css";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** The CSS a file holds: all of a .css file, or the <style> blocks of an .astro file. */
function cssOf(path: string): string {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".css")) return text;
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "").join("\n");
}

const styled = files(SOURCE).filter((path) => /\.(astro|css)$/.test(path));
const defined = new Set(
  [...readFileSync(TOKENS, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""),
);

describe("design tokens", () => {
  // A weight, a leading, a duration, a curve or a named colour counts as much as a px.
  it.each(styled)("%s uses no raw colour, size, weight, leading or motion", (path) => {
    expect(rawValues(cssOf(path))).toEqual([]);
  });

  it.each(styled)("%s uses only tokens that are defined", (path) => {
    const css = cssOf(path);
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? "");
    expect(used.filter((name) => !defined.has(name) && !local.has(name))).toEqual([]);
  });

  it("holds the brand's five colours as the brand README gives them", () => {
    const tokens = readFileSync(TOKENS, "utf8");
    for (const [name, value] of [
      ["--ink", "#16233a"],
      ["--gilt", "#c9a363"],
      ["--brass", "#b98b45"],
      ["--paper", "#e9e4d8"],
      ["--text", "#1a1714"],
    ]) {
      expect(tokens).toContain(`${name ?? ""}: ${value ?? ""};`);
    }
  });
});

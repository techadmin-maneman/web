// Every colour, size and space on the site comes from site/src/styles/tokens.css:
// no component writes a raw colour, px, vw or em value, and every token a
// component uses is defined there.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = "site/src";
const TOKENS = "site/src/styles/tokens.css";
/** Font files and their unicode ranges are not design values. */
const EXEMPT = new Set([TOKENS, "site/src/styles/fonts.css"]);

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

/** Media query conditions cannot use custom properties, so they keep their px. */
function withoutMediaConditions(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "@media {");
}

const styled = files(SOURCE).filter((path) => /\.(astro|css)$/.test(path) && !EXEMPT.has(path));
const defined = new Set(
  [...readFileSync(TOKENS, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""),
);

describe("design tokens", () => {
  it.each(styled)("%s uses no raw colour or size", (path) => {
    const css = withoutMediaConditions(cssOf(path));
    const raw = [
      ...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|vw|em|rem)\b|\b(?!100vh)\d+(?:\.\d+)?vh\b/g),
    ].map((match) => match[0]);
    expect(raw).toEqual([]);
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

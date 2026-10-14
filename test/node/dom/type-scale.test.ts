// One type scale, in the file every surface loads (packages/brand/tokens.css), and named text styles made of it
// (packages/ui/type.module.css). A step written anywhere else, or a size typed in pixels, is how the ramp grew a step
// at every pixel before.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return ["node_modules", "dist"].includes(entry.name) ? [] : filesUnder(path);
    return /\.(css|astro)$/.test(entry.name) ? [path] : [];
  });
}

const STYLESHEETS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "packages/ui", "site/src"].flatMap(filesUnder);
const scale = new Set([...read("packages/brand/tokens.css").matchAll(/(--fs-\d+):/g)].map((match) => match[1]));

describe("the type scale", () => {
  it("is written in tokens.css alone", () => {
    const elsewhere = ["packages/brand/tokens-apps.css", "site/src/styles/tokens-site.css"].filter((path) =>
      /--fs-\d+:/.test(read(path)),
    );
    expect(elsewhere).toEqual([]);
  });

  it("is what every size reads: a step on it, or a name pointing at one, never pixels", () => {
    const raw = STYLESHEETS.filter((path) => /font-size:\s*[\d.]+(px|rem|em)\b/.test(read(path)));
    expect(raw).toEqual([]);
    const offScale = STYLESHEETS.flatMap((path) =>
      [...read(path).matchAll(/var\((--fs-\d+)\)/g)].map((match) => match[1] ?? "").filter((step) => !scale.has(step)),
    );
    expect(offScale).toEqual([]);
  });

  it("names its text styles from the scale, each with its leading or caps", () => {
    const css = read("packages/ui/type.module.css");
    for (const style of ["display", "title1", "title2", "title3", "bodyLarge", "body", "label", "caption", "figure"]) {
      // Every rule whose selectors name the style, those it shares with others too.
      const rule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .filter((match) => (match[1] ?? "").split(",").some((selector) => selector.trim() === `.${style}`))
        .map((match) => match[2] ?? "")
        .join("");
      expect(rule, style).toMatch(/font-size: var\(--fs-\d+\)/);
      expect(rule, style).toMatch(/line-height|font-variant-caps/);
    }
  });

  it("sets the body’s leading, and bold at a weight the fonts load", () => {
    const base = read("packages/ui/base.css");
    expect(base).toMatch(/body \{[^}]*line-height: var\(--lh-145\)/);
    expect(base).toMatch(/strong,\s*b \{\s*font-weight: var\(--weight-medium\)/);
  });
});

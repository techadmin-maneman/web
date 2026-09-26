// Each Phase 2 app, and the components they share (packages/ui), takes every
// colour, size and space from packages/brand, as the public site does
// (test/node/site-tokens.test.ts): no stylesheet writes a raw value, and every
// token one uses is defined in tokens.css or tokens-phase2.css, or is a
// property the stylesheet declares for itself, as the compare's divider
// position is.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APPS = [
  ["the client app", "apps/app/src"],
  ["the ops console", "apps/ops/src"],
  ["the technician app", "apps/tech/src"],
  ["the apps' shared components", "packages/ui"],
] as const;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const tokenNames = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? "");
const defined = new Set([
  ...tokenNames("packages/brand/tokens.css"),
  ...tokenNames("packages/brand/tokens-phase2.css"),
  // The sizes each app gives its buttons, and the focus ring's colour (packages/ui/base.css).
  ...tokenNames("packages/ui/base.css"),
]);

/** Media query conditions cannot use custom properties, so they keep their px. */
const withoutMediaConditions = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "@media {");

describe.each(APPS)("%s's design tokens", (_app, source) => {
  const stylesheets = files(source).filter((path) => path.endsWith(".css"));
  const components = files(source).filter((path) => path.endsWith(".tsx"));

  it("has stylesheets to check", () => {
    expect(stylesheets.length).toBeGreaterThan(0);
  });

  it.each(stylesheets)("%s uses no raw colour or size", (path) => {
    const css = withoutMediaConditions(readFileSync(path, "utf8"));
    const raw = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|\b\d+(?:\.\d+)?(?:px|vw|em|rem)\b/g)].map((m) => m[0]);
    expect(raw).toEqual([]);
  });

  it.each(stylesheets)("%s uses only tokens that are defined", (path) => {
    const css = readFileSync(path, "utf8");
    const own = new Set(tokenNames(path));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? "");
    expect(used.filter((name) => !defined.has(name) && !own.has(name))).toEqual([]);
  });

  it.each(components)("%s sets no inline style, which the policy would refuse", (path) => {
    expect(readFileSync(path, "utf8")).not.toMatch(/\bstyle=\{/);
  });
});

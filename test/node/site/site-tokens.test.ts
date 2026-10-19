// Every colour, size and space on the site comes from packages/brand/tokens.css or the site's own
// site/src/styles/tokens-site.css: no component writes a raw colour, px, vw or em value, and every token a
// component uses is defined in one of them. The site does not use the apps' layer.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rawValues } from "../raw-values.ts";

const SOURCE = "site/src";
const TOKENS = "packages/brand/tokens.css";
/** The site's own layer, where its values are written, as tokens.css's are. */
const SITE_TOKENS = "site/src/styles/tokens-site.css";

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

const styled = files(SOURCE).filter((path) => /\.(astro|css)$/.test(path) && path !== SITE_TOKENS);
const defined = new Set(
  [TOKENS, SITE_TOKENS].flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""),
  ),
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

  it("holds the brand’s five colours as the brand README gives them", () => {
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

  // The code's boxes and the times drew at their words' height, since their height was the apps' alone.
  it("defines every token the shared controls it uses read", () => {
    // The shared base the site loads with its tokens (site/src/styles/global.css) sets the controls' sizes.
    const base = new Set(
      [...readFileSync("packages/ui/base.css", "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""),
    );
    // The apps' column and card widths, which base.css gives the apps' drawers, columns and menus: the site draws none.
    const appsLayout = new Set(["--app-column", "--skeleton-card"]);
    const missing = [{ path: TOKENS, css: readFileSync(TOKENS, "utf8") }, ...sharedStyles()].flatMap(
      ({ path, css }) => {
        const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""));
        const allowed = path === "packages/ui/base.css" ? appsLayout : new Set<string>();
        return [...css.matchAll(/var\((--[a-z0-9-]+)/g)]
          .map((match) => match[1] ?? "")
          .filter((name) => !defined.has(name) && !base.has(name) && !local.has(name) && !allowed.has(name))
          .map((name) => `${path}: ${name}`);
      },
    );
    expect([...new Set(missing)]).toEqual([]);
  });
});

/** The stylesheets of the shared controls the site imports, and of what they import in turn. */
function sharedStyles(): { path: string; css: string }[] {
  const exported = (JSON.parse(readFileSync("packages/ui/package.json", "utf8")) as { exports: Record<string, string> })
    .exports;
  const entries = new Set(
    styled
      .concat(files(SOURCE).filter((path) => /\.(tsx?|css)$/.test(path)))
      .flatMap((path) => [...readFileSync(path, "utf8").matchAll(/@maneman\/ui\/([\w.-]+)/g)])
      .map((match) => exported[`./${match[1] ?? ""}`])
      .filter((path): path is string => path !== undefined)
      .map((path) => join("packages/ui", path).replace(/\\/g, "/")),
  );
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const path = queue.pop() ?? "";
    if (seen.has(path)) continue;
    seen.add(path);
    if (path.endsWith(".css")) continue;
    for (const match of readFileSync(path, "utf8").matchAll(/from "\.\/([\w.-]+)"|import "\.\/([\w.-]+)"/g)) {
      const name = match[1] ?? match[2] ?? "";
      const local = ["", ".tsx", ".ts"]
        .map((end) => `packages/ui/${name}${end}`)
        .find((file) => {
          try {
            return statSync(file).isFile();
          } catch {
            return false;
          }
        });
      if (local !== undefined) queue.push(local);
    }
  }
  return [...seen].filter((path) => path.endsWith(".css")).map((path) => ({ path, css: readFileSync(path, "utf8") }));
}

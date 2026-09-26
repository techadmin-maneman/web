// The three React apps share one component layer, packages/ui (DS-23,
// FEA-40): what they have in common is written there once, and no app keeps a
// copy of its own. A copy is how the apps drifted apart before, a fix reaching
// one app and not the others (the audit of 24 September 2026).

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APPS = ["apps/app", "apps/ops", "apps/tech"] as const;

const read = (path: string) => readFileSync(path, "utf8");

describe("the shared stylesheets", () => {
  // The recipe for hiding words must win over any screen's rule, so it stays out of the layers.
  const layered = readdirSync("packages/ui").filter(
    (name) => name.endsWith(".css") && name !== "visually-hidden.module.css",
  );

  it.each(layered)("%s names the layers in their order before anything else", (name) => {
    const css = read(`packages/ui/${name}`)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    expect(css.startsWith("@layer base, ui;")).toBe(true);
  });

  it.each(layered)("%s puts every rule in a layer, so an app's own rule wins over it", (name) => {
    const css = read(`packages/ui/${name}`)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    const outside = css.replace("@layer base, ui;", "").trim();
    expect(outside).toMatch(/^@layer (base|ui) \{[\s\S]*\}$/);
  });
});

describe.each(APPS)("%s", (app) => {
  it("takes the shared layer as a dependency", () => {
    const manifest = JSON.parse(read(`${app}/package.json`)) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@maneman/ui"]).toBe("0.0.0");
  });

  it("bundles one React, its own, for the shared components as for its own", () => {
    // packages/ui would otherwise find the repository root's React 18, kept there for the fidelity runs.
    expect(read(`${app}/vite.config.ts`)).toMatch(/dedupe:\s*\["react",\s*"react-dom"\]/);
  });

  it("starts its stylesheet from the shared base, and repeats none of it", () => {
    const global = read(`${app}/src/styles/global.css`);
    expect(global).toContain('@import "@maneman/ui/base.css";');
    expect(global).not.toMatch(/box-sizing|prefers-reduced-motion|font-smoothing/);
  });
});

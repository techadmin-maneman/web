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

  const sources = filesUnder(`${app}/src`);
  const code = sources.filter((path) => /\.tsx?$/.test(path) && !path.endsWith("api-schema.ts"));
  const styles = sources.filter((path) => path.endsWith(".css"));

  // An app's ErrorBoundary only chooses what the shared one shows; a class component would be a copy of it.
  it("keeps no icon, mark, router, loader, tap guard or error boundary of its own", () => {
    const copies = code.filter((path) =>
      /\bfunction (Icon|Mark|usePath|useLoad|useOneAtATime)\b|\bclass \w+ extends (React\.)?Component\b/.test(
        read(path),
      ),
    );
    expect(copies).toEqual([]);
  });

  // P3-34 (UX-16): a box's label, hint and error are tied together by the shared Field alone.
  it("keeps no field wrapper of its own", () => {
    const copies = code.filter((path) => /\bfunction (Field|Box)\b/.test(read(path)));
    expect(copies).toEqual([]);
  });

  // P3-33 (UX-14): the code's boxes, a countdown, and focus given back to a new screen's heading.
  it("keeps no code field, countdown or focus hand-back of its own", () => {
    const copies = code.filter((path) =>
      /\bfunction (CodeField|CodeBoxes|useSecondsLeft|useCountdown|focusIfLost)\b|\.replace\(\/\\D\/g, ""\)\.slice\(0, ONE_TIME_CODE/.test(
        read(path),
      ),
    );
    expect(copies).toEqual([]);
  });

  it("hides words for a screen reader with the shared VisuallyHidden alone", () => {
    const recipes = styles.filter((path) => /clip:\s*rect\(0|clip-path:\s*inset\(50%\)/.test(read(path)));
    expect(recipes).toEqual([]);
  });

  it("calls the API through the shared client alone", () => {
    const own = code.filter((path) => /\bfetch\(\s*["'`]\/api\//.test(read(path)));
    expect(own).toEqual([]);
  });
});

// A service worker is registered as a classic script, which cannot import: built with a module the app's own pages
// import too, it would load the app's chunk with an import statement and fail to install. So it takes nothing from the
// packages but the workers' own kit, which imports nothing and which nothing but a worker imports, so it is bundled into
// each sw.js whole.
const WORKER_KIT = ["packages/web-kit/sw-shell.ts", "packages/web-kit/sw-requests.ts"];
const importsOf = (path: string) =>
  [...read(path).matchAll(/^import [^;]*? from "([^"]+)";/gms)].map((match) => match[1] ?? "");

describe.each(["apps/app", "apps/tech"])("%s's service worker", (app) => {
  it("imports only its own files and the workers' kit", () => {
    const imports = filesUnder(`${app}/sw`)
      .filter((path) => path.endsWith(".ts"))
      .flatMap(importsOf);
    const kit = WORKER_KIT.map((file) => `../../../${file}`);
    expect(imports.filter((from) => !from.startsWith("./") && !kit.includes(from))).toEqual([]);
  });
});

describe("the workers' kit", () => {
  it("imports nothing", () => {
    for (const file of WORKER_KIT) expect(importsOf(file), file).toEqual([]);
  });

  it("is imported by a service worker alone", () => {
    const source = ["apps", "packages", "site/src"]
      .flatMap(filesUnder)
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/\/(node_modules|dist)\//.test(path));
    const importers = source.filter((path) => importsOf(path).some((from) => /\/sw-(shell|requests)\.ts$/.test(from)));
    expect(importers.filter((path) => !/^apps\/(app|tech)\/sw\//.test(path))).toEqual([]);
  });
});

/** Every file under a directory. */
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

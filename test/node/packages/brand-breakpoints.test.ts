// Every surface changes layout at the same widths (packages/brand/breakpoints.ts): the site broke at four widths
// from no shared list, and the console at a fifth.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIA } from "../../../packages/brand/breakpoints.ts";

const ROOTS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "packages/ui", "site/src"];

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (["node_modules", "dist", ".astro"].includes(entry.name)) return [];
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const sheets = ROOTS.flatMap(filesUnder).filter((path) => /\.(css|astro)$/.test(path));
const listed = new Set<string>(Object.values(MEDIA));

describe("the widths a layout changes at", () => {
  it("are each one of the list's", () => {
    const off = sheets.flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/@media\s+([^{]*?)\s*\{/g)]
        .map((match) => match[1] ?? "")
        .flatMap((condition) => condition.match(/\((?:min|max)-width:[^)]*\)/g) ?? [])
        .filter((width) => !listed.has(width))
        .map((width) => `${path} ${width}`),
    );
    expect(off).toEqual([]);
  });

  it("are read by a script from the list, never written out", () => {
    const scripts = ROOTS.flatMap(filesUnder).filter((path) => /\.tsx?$/.test(path) && !path.endsWith("api-schema.ts"));
    const written = scripts.filter((path) => /["'`]\((?:min|max)-width:/.test(readFileSync(path, "utf8")));
    expect(written).toEqual([]);
  });
});

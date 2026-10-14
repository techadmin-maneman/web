// Each size is written once in the token files a surface loads together, and the colour roles are aliases of the
// palette, each redefined on the ink. A value written under several names drifts one name at a time; a role holding
// a colour of its own could not be re-themed.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The token files each surface loads, together. */
const LOADED_TOGETHER = {
  "the client app": ["packages/brand/tokens.css", "packages/brand/tokens-apps.css"],
  "the ops console": ["packages/brand/tokens.css", "packages/brand/tokens-apps.css", "apps/ops/src/styles/tokens.css"],
  "the technician app": [
    "packages/brand/tokens.css",
    "packages/brand/tokens-apps.css",
    "apps/tech/src/styles/tokens.css",
  ],
  "the site": ["packages/brand/tokens.css", "site/src/styles/tokens-site.css"],
};

const declarations = (path: string) =>
  [
    ...readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g),
  ].map((match) => ({ name: match[1] ?? "", value: (match[2] ?? "").trim() }));

describe.each(Object.entries(LOADED_TOGETHER))("%s's tokens", (_surface, files) => {
  // A type size and a space may share a figure; within each kind a figure has one name.
  it("write each size once, the other names pointing at it", () => {
    const byValue = new Map<string, string[]>();
    for (const { name, value } of files.flatMap(declarations)) {
      if (!/^-?[\d.]+px$/.test(value) || name.startsWith("--fs-")) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    expect([...byValue].filter(([, names]) => names.length > 1)).toEqual([]);
  });
});

// A screen's own width, as --local-*, is written once across the console and is no token's: a width two screens share
// is a console token (apps/ops/src/styles/tokens.css), which each names for what its column holds.
describe("the console's own widths", () => {
  const sheets = execFileSync("git", ["ls-files", "apps/ops/src"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path.endsWith(".module.css"));
  const local = sheets.flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/(--local-[a-z0-9-]+)\s*:\s*([\d.]+px)\s*;/g)].map((match) => ({
      name: match[1] ?? "",
      value: match[2] ?? "",
    })),
  );
  const tokenValues = new Set(LOADED_TOGETHER["the ops console"].flatMap(declarations).map(({ value }) => value));

  it("are each written once, and are no token's value", () => {
    const values = local.map(({ value }) => value);
    expect(local.filter(({ value }, index) => values.indexOf(value) !== index || tokenValues.has(value))).toEqual([]);
  });
});

describe("the colour roles", () => {
  const css = readFileSync("packages/brand/tokens.css", "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    return declarations("packages/brand/tokens.css").filter(({ name }) => {
      const at = css.indexOf(`${name}:`, start);
      return start !== -1 && at > start && at < css.indexOf("}", start);
    });
  };
  const roles = block('[data-ground="ink"]').map(({ name }) => name);

  it("are each an alias of the palette, on paper and on the ink", () => {
    expect(roles.length).toBeGreaterThan(5);
    const onPaper = css.slice(css.lastIndexOf(":root {"));
    for (const role of roles) expect(onPaper, role).toMatch(new RegExp(`${role}: var\\(--[a-z0-9-]+\\);`));
    for (const { name, value } of block('[data-ground="ink"]')) expect(value, name).toMatch(/^var\(--[a-z0-9-]+\)$/);
  });
});

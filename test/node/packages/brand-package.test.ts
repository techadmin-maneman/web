// packages/brand holds the design's values, unaltered: the icons and drawings
// as the design files draw them, the site's first icons frozen, and the apps' colour
// layer that adds to tokens.css without redefining any of it.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GLYPHS, ICONS, ICONS_P2 } from "../../../packages/brand/icons.ts";
import { MARK, WORDMARK, WORDMARK_SMALL, type Drawing } from "../../../packages/brand/marks.ts";

const SPEC_BOARDS = ["Client App", "Referral and Waitlist", "Technician App", "Ops Console"].map((board) =>
  readFileSync(`design/phase2/${board}.dc.html`, "utf8"),
);

/** "Tax document" → taxDocument, "Piece ID" → pieceId. */
function camelCase(name: string): string {
  const [first = "", ...rest] = name.toLowerCase().split(" ");
  return first + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

function customProperties(path: string): Map<string, string> {
  const css = readFileSync(path, "utf8");
  return new Map([...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1] ?? "", match[2] ?? ""]));
}

describe("icons", () => {
  it("ICONS_P2 is the design's nine new glyphs, path for path", () => {
    const board = readFileSync("design/phase2/Client App.dc.html", "utf8");
    const drawn = [...board.matchAll(/\{ name: '([^']+)', d: '([^']+)' \}/g)].map((match) => [
      camelCase(match[1] ?? ""),
      match[2],
    ]);
    expect(drawn).toHaveLength(9);
    expect(Object.entries(ICONS_P2)).toEqual(drawn);
  });

  it("ICONS_P2 reuses none of the Phase 1 icon names", () => {
    expect(Object.keys(ICONS_P2).filter((name) => name in ICONS)).toEqual([]);
  });

  it("GLYPHS, the apps' own, repeats none of the icon sets", () => {
    const sets = new Set<string>([...Object.values(ICONS), ...Object.values(ICONS_P2)]);
    expect(Object.values(GLYPHS).filter((path) => sets.has(path))).toEqual([]);
  });

  // The technician app re-declared five of the set's glyphs, and both apps the chevron and the tick.
  it.each(["apps/app/src/icons.ts", "apps/tech/src/icons.ts"])("%s declares no glyph the brand holds", (file) => {
    const held = new Set<string>([...Object.values(ICONS), ...Object.values(ICONS_P2), ...Object.values(GLYPHS)]);
    const declared = [...readFileSync(file, "utf8").matchAll(/"(M[^"]+)"/g)].map((match) => match[1] ?? "");
    expect(declared.filter((path) => held.has(path))).toEqual([]);
  });

  it("ICONS is frozen as the Phase 1 site draws it", () => {
    // A change here changes the site's island bundles: add a glyph to a new set instead.
    expect(createHash("sha256").update(JSON.stringify(ICONS)).digest("hex")).toBe(
      "39c2c60a6d445b9610b5e6e33df05c8204ac3abe65148ae54082b98821888484",
    );
  });
});

describe("marks", () => {
  it.each<[string, Drawing]>([
    ["mark-", MARK],
    ["wordmark-small-", WORDMARK_SMALL],
    ["wordmark-navy", WORDMARK],
    ["wordmark-white", WORDMARK],
  ])("design/brand/%s* draws exactly this", (prefix, drawing) => {
    const files = readdirSync("design/brand").filter((file) => file.startsWith(prefix));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const svg = readFileSync(`design/brand/${file}`, "utf8");
      expect(svg, file).toContain(`viewBox="${drawing.viewBox}"`);
      expect(
        [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((match) => match[1]),
        file,
      ).toEqual([drawing.d]);
    }
  });
});

describe("every token", () => {
  const files = ["packages/brand/tokens.css", "packages/brand/tokens-phase2.css"];
  const names = files.flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ""),
  );

  // --fs-30 was once defined twice, which a Map of the names hides.
  it("is defined once across the brand's token files", () => {
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  // Eleven were left behind by the site's first booking form.
  it("is used by a stylesheet, a component or a script, or it is not a token", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (["node_modules", "dist", ".astro"].includes(entry.name)) return [];
        return entry.isDirectory() ? walk(path) : [path];
      });
    const text = ["apps", "site/src", "packages", "scripts"]
      .flatMap(walk)
      .filter((path) => /\.(css|astro|tsx?|html)$/.test(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const used = new Set([...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
    expect(names.filter((name) => !used.has(name))).toEqual([]);
  });
});

describe("the Phase 2 colour layer", () => {
  const core = customProperties("packages/brand/tokens.css");
  const phase2 = customProperties("packages/brand/tokens-phase2.css");

  it("adds names and redefines none of tokens.css", () => {
    expect(phase2.size).toBeGreaterThan(0);
    expect([...phase2.keys()].filter((name) => core.has(name))).toEqual([]);
  });

  it("adds no colour tokens.css already has", () => {
    const isColour = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value);
    const coreColours = new Set([...core.values()].filter(isColour));
    expect([...phase2.values()].filter((value) => isColour(value) && coreColours.has(value))).toEqual([]);
  });

  // A role that names another token (--fs-app-title is --fs-34) is checked through the token it names.
  it.each([...phase2].filter(([, value]) => !value.startsWith("var(")))(
    "%s (%s) is drawn in a Phase 2 spec board",
    (_name, value) => {
      const drawnIn = SPEC_BOARDS.filter((board) => board.toLowerCase().includes(value.toLowerCase()));
      expect(drawnIn.length).toBeGreaterThan(0);
    },
  );
});

// --fs-app-title and --fs-34 both held 34px, so a change to one would leave the other behind. A
// value is written once in its family; a name for what it is for says which token it is.
describe("the scale", () => {
  const all = new Map([
    ...customProperties("packages/brand/tokens.css"),
    ...customProperties("packages/brand/tokens-phase2.css"),
  ]);
  const familyOf = (name: string) => name.replace(/^--/, "").split("-")[0] ?? "";

  it.each(["fs", "sp", "lh", "weight", "duration"])("writes each --%s value once", (family) => {
    const raw = [...all].filter(([name, value]) => familyOf(name) === family && !value.startsWith("var("));
    const values = raw.map(([, value]) => value);
    expect(raw.filter(([, value], index) => values.indexOf(value) !== index)).toEqual([]);
  });

  it("names only tokens that exist where one token is another", () => {
    const aliases = [...all].filter(([, value]) => value.startsWith("var("));
    expect(aliases.length).toBeGreaterThan(0);
    const missing = aliases.filter(([, value]) => !all.has(/^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1] ?? ""));
    expect(missing).toEqual([]);
  });
});

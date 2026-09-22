// packages/brand holds the design's values, unaltered: the icons and drawings
// as the design files draw them, Phase 1's icons frozen, and a Phase 2 colour
// layer that adds to tokens.css without redefining any of it.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS, ICONS_P2 } from "../../packages/brand/icons.ts";
import { MARK, WORDMARK, WORDMARK_SMALL, type Drawing } from "../../packages/brand/marks.ts";

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

describe("the Phase 2 colour layer", () => {
  const core = customProperties("packages/brand/tokens.css");
  const phase2 = customProperties("packages/brand/tokens-phase2.css");

  it("adds names and redefines none of tokens.css", () => {
    expect(phase2.size).toBeGreaterThan(0);
    expect([...phase2.keys()].filter((name) => core.has(name))).toEqual([]);
  });

  it("adds no colour tokens.css already has", () => {
    const coreValues = new Set(core.values());
    expect([...phase2.values()].filter((value) => coreValues.has(value))).toEqual([]);
  });

  it.each([...phase2])("%s (%s) is drawn in a Phase 2 spec board", (_name, value) => {
    const drawnIn = SPEC_BOARDS.filter((board) => board.toLowerCase().includes(value.toLowerCase()));
    expect(drawnIn.length).toBeGreaterThan(0);
  });
});

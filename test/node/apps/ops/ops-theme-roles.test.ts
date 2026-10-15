// The console's stylesheets draw in the roles (packages/brand/tokens.css, the --ui-* and the grounds'), never in the
// palette, so its dark theme (apps/ops/src/styles/theme.css) reaches every screen. What is drawn on the ink on purpose,
// the dispatch board's first fits, and what is printed, keep the palette's own.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rulesOf } from "../../contrast.ts";

const PALETTE =
  /var\(--(paper(?:-[a-z]+)?|ink(?:-[a-z]+)?|text(?:-[a-z]+)?|white|gilt|brass(?:-text)?|error-on-[a-z]+)\)/g;

/** The theme's own files, and the sheets that only print. */
const THEMED_ELSEWHERE = /styles[\\/]|label-sheet\.module\.css$|order-sheet\.module\.css$/;

/** A rule drawn on the ink on purpose. */
const ON_INK = /\.fit\b/;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

describe("the console's stylesheets", () => {
  const sheets = stylesheets("apps/ops/src").filter((path) => !THEMED_ELSEWHERE.test(path));

  it("are read, so the check below checks something", () => {
    expect(sheets.length).toBeGreaterThan(50);
  });

  it("draw in the roles, so the dark theme reaches them", () => {
    const drawn = sheets.flatMap((file) =>
      rulesOf(file).flatMap(([selector, body]) =>
        ON_INK.test(selector)
          ? []
          : [...body.matchAll(PALETTE)].map((match) => `${file.replace(/\\/g, "/")} ${selector} ${match[0]}`),
      ),
    );
    expect(drawn).toEqual([]);
  });
});

// The console's two themes read alike: each colour words are drawn in reads at 4.5:1 on each ground the paper looks
// stand on (WCAG 1.4.3), in the light theme (packages/brand/tokens.css) and the dark (apps/ops/src/styles/theme.css),
// and the navigation's words on its ink.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ratio } from "../../contrast.ts";

const HEX = new Map(
  ["packages/brand/tokens.css", "packages/brand/tokens-apps.css"].flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(
      ([, name = "", hex = ""]) => [name, hex] as const,
    ),
  ),
);

/** The aliases a stylesheet's blocks for one selector set, the last of each winning. */
function aliases(file: string, selector: string): Map<string, string> {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, string>();
  for (let start = css.indexOf(`${selector} {`); start !== -1; start = css.indexOf(`${selector} {`, start + 1)) {
    const block = css.slice(start, css.indexOf("}", start));
    for (const [, name = "", token = ""] of block.matchAll(/(--[\w-]+):\s*var\((--[\w-]+)\)/g)) found.set(name, token);
  }
  return found;
}

const LIGHT = new Map([
  ...aliases("packages/brand/tokens.css", ":root"),
  ...aliases("packages/brand/tokens-apps.css", ":root"),
  ...aliases("packages/ui/base.css", ":root"),
]);
const DARK = new Map([...LIGHT, ...aliases("apps/ops/src/styles/theme.css", ':root[data-theme="dark"]')]);

/** A token's colour in a theme, through as many aliases as it takes. */
function hexOf(theme: ReadonlyMap<string, string>, token: string): string {
  let name = token;
  for (let step = 0; step < 6 && !HEX.has(name); step += 1) name = theme.get(name) ?? name;
  const hex = HEX.get(name);
  if (hex === undefined) throw new Error(`${token} has no colour`);
  return hex;
}

const WORDS = ["--ui-text", "--ui-text-soft", "--ui-text-muted", "--ui-error", "--ui-attention"];
const GROUNDS = ["--ui-ground", "--ui-raised", "--ui-box"];
const PAIRS = [
  ...WORDS.flatMap((words) => GROUNDS.map((ground) => [words, ground] as const)),
  ["--ui-hint", "--ui-box"] as const,
  ["--ui-on-strong", "--ui-strong"] as const,
  ["--nav-text", "--nav-ground"] as const,
  ["--nav-label", "--nav-ground"] as const,
  ["--nav-text-current", "--nav-current"] as const,
];

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
] as const)("the console's %s theme", (_name, theme) => {
  it.each(PAIRS)("%s on %s reads at 4.5:1", (words, ground) => {
    expect(ratio(hexOf(theme, words), hexOf(theme, ground))).toBeGreaterThanOrEqual(4.5);
  });

  // A box's edge is what shows it is there (WCAG 1.4.11).
  it.each(GROUNDS)("a control's edge on %s clears 3:1", (ground) => {
    expect(ratio(hexOf(theme, "--ui-line-control"), hexOf(theme, ground))).toBeGreaterThanOrEqual(3);
  });
});

describe("the dark theme", () => {
  it("sets the same roles for a choice of dark and for the computer's", () => {
    const css = readFileSync("apps/ops/src/styles/theme.css", "utf8");
    const chosen = aliases("apps/ops/src/styles/theme.css", ':root[data-theme="dark"]');
    const computer = aliases("apps/ops/src/styles/theme.css", ':root:not([data-theme="light"])');
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect([...computer]).toEqual([...chosen]);
  });

  it("turns every paper look's role to the ink's", () => {
    const paperLooks = [...readFileSync("packages/brand/tokens.css", "utf8").matchAll(/(--ui-[\w-]+):/g)].map(
      ([, name = ""]) => name,
    );
    const dark = aliases("apps/ops/src/styles/theme.css", ':root[data-theme="dark"]');
    expect(paperLooks.filter((name) => !dark.has(name))).toEqual([]);
  });
});

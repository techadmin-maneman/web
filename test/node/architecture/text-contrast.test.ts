// A rule that sets both a text colour and its own ground holds the two at 4.5:1 or more (WCAG 1.4.3), on every
// surface. The pairs were mostly strong; the client app's full day was 2.15:1 (--paper-placeholder on --paper-shade),
// and nothing stopped brass or gilt from being set as text on paper. A disabled control is WCAG's own exception.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rulesOf, tokenRatio } from "../contrast.ts";

const ROOTS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "packages/ui", "site/src"];
const DISABLED = /:disabled|aria-disabled|::placeholder|::backdrop/;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replace(/\\/g, "/");
    if (["node_modules", "dist", ".astro"].includes(name)) return [];
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** Each rule that sets a colour and a ground, both from the brand's tokens, with the two. */
function pairs(): { where: string; text: string; ground: string }[] {
  return ROOTS.flatMap(stylesheets).flatMap((file) =>
    rulesOf(file).flatMap(([selector, body]) => {
      const text = /(?:^|[;\s])color\s*:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
      const ground = /background(?:-color)?\s*:\s*var\((--[\w-]+)\)/.exec(body)?.[1];
      if (text === undefined || ground === undefined || DISABLED.test(selector)) return [];
      return [{ where: `${file} ${selector.replace(/\s+/g, " ")}`, text, ground }];
    }),
  );
}

/** The ratio, where both are the brand's colours; null for a property of the rule's own. */
function ratioOf(text: string, ground: string): number | null {
  try {
    return tokenRatio(text, ground);
  } catch {
    return null;
  }
}

describe("a colour set on its own ground", () => {
  const found = pairs();

  it("is read from every surface's stylesheets, so the check below checks something", () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it("reads at 4.5:1 or more", () => {
    const weak = found.flatMap(({ where, text, ground }) => {
      const value = ratioOf(text, ground);
      return value !== null && value < 4.5 ? [`${where}: ${text} on ${ground} ${value.toFixed(2)}`] : [];
    });
    expect(weak).toEqual([]);
  });
});

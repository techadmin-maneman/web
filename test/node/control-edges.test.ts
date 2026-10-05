// A control's edge shows that it is there, so WCAG 1.4.11 holds it to 3:1 against its ground. The boards draw
// fields, tiles and boxes in --paper-line (1.3:1 on paper) and --ink-line (1.75:1 on the ink); the apps draw them
// in --paper-control and --ink-line-strong instead (ADR 0025, item 36). The technician app's edges are
// test/node/tech-contrast.test.ts's; this holds the client app's, the console's and the shared fields'.
//
// A control is read from its selector: a field, an input, a select, a box, a tile or a choice. A disabled control
// needs no contrast (WCAG's own exception), and the console's check panel is a panel, not a control.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rulesOf, tokenRatio } from "./contrast.ts";

/** Each edge a control may be drawn in, and the grounds it is drawn on. */
const EDGES: Readonly<Record<string, readonly string[]>> = {
  "--paper-control": ["--paper", "--white", "--paper-light"],
  "--ink-line-strong": ["--ink", "--ink-deep"],
  // A control chosen, or refused.
  "--ink": ["--paper", "--white"],
  "--error-on-paper": ["--paper", "--white"],
  "--error-on-ink": ["--ink", "--ink-deep"],
};

const CONTROL =
  /input|field|select|\.box\b|\.date\b|\.number\b|\.text\b|\.day\b|\.window\b|radio|switch|choice|picker|\.cell/i;
const NOT_A_CONTROL = /:disabled|^\.check$/;

function stylesheets(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return stylesheets(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

/** Each control rule's edge token, by file and selector; a property of the rule's own, such as the code boxes', is left out. */
function controlEdges(): { where: string; edge: string }[] {
  return ["apps/app/src", "apps/ops/src", "packages/ui"].flatMap((dir) =>
    stylesheets(dir).flatMap((file) =>
      rulesOf(file).flatMap(([selector, body]) => {
        const plain = selector.replace(/\s+/g, " ").trim();
        if (!CONTROL.test(plain) || NOT_A_CONTROL.test(plain)) return [];
        const edge = /border(?:-color)?\s*:[^;]*var\((--[\w-]+)\)/.exec(body)?.[1];
        if (edge === undefined || edge.startsWith("--code-box-")) return [];
        return [{ where: `${file.replace(/\\/g, "/")} ${plain}`, edge }];
      }),
    ),
  );
}

describe("the controls' edges, in the client app, the console and the shared fields", () => {
  const edges = controlEdges();

  it("reads every stylesheet's controls, so the check below checks something", () => {
    expect(edges.length).toBeGreaterThanOrEqual(30);
  });

  it("draws each control's edge in a colour that clears 3:1", () => {
    expect(edges.filter(({ edge }) => !(edge in EDGES))).toEqual([]);
  });

  it.each(Object.entries(EDGES).flatMap(([edge, grounds]) => grounds.map((ground) => [edge, ground] as const)))(
    "%s on %s clears 3:1",
    (edge, ground) => {
      expect(tokenRatio(edge, ground)).toBeGreaterThanOrEqual(3);
    },
  );

  it("does not draw an edge in the boards' --paper-line or --ink-line, which fall short", () => {
    expect(tokenRatio("--paper-line", "--paper")).toBeLessThan(3);
    expect(tokenRatio("--ink-line", "--ink")).toBeLessThan(3);
  });
});

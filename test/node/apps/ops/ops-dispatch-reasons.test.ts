// A dispatch move keeps one reason, chosen from round radios whose edges can
// be seen against the panel: 3:1, as WCAG 1.4.11 asks of a control's edge.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarationsOf, edgeOf, tokenRatio } from "../../contrast.ts";

const STYLES = "apps/ops/src/dispatch/dispatch.module.css";

function valueOf(selector: string, property: string): string | undefined {
  return declarationsOf(STYLES, selector).findLast(([name]) => name === property)?.[1];
}

describe("a move's reasons", () => {
  it("sit on the panel's paper", () => {
    expect(valueOf(".panel", "background")).toBe("var(--paper)");
  });

  it("are edged at 3:1 against it", () => {
    expect(tokenRatio(edgeOf(STYLES, ".radio"), "--paper")).toBeGreaterThanOrEqual(3);
  });

  it("are drawn round, since only one is kept", () => {
    expect(readFileSync("apps/ops/src/dispatch/MovePicker.tsx", "utf8")).toContain('type="radio"');
    expect(valueOf(".radio", "border-radius")).toBe("50%");
  });
});

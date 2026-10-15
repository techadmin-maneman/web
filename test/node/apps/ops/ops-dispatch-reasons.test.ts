// A dispatch move keeps one reason, chosen from the shared radios (@maneman/ui/Field's Radio, in a ruled
// ChoiceGroup): round, as the browser draws one of a few, and in the ink, which clears 3:1 against the panel's paper,
// as WCAG 1.4.11 asks of a control's edge.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarationsOf, tokenRatio } from "../../contrast.ts";

const PICKER = "apps/ops/src/dispatch/MovePicker.tsx";

const valueOf = (file: string, selector: string, property: string): string | undefined =>
  declarationsOf(file, selector).findLast(([name]) => name === property)?.[1];

describe("a move’s reasons", () => {
  it("sit on the panel’s paper", () => {
    expect(valueOf("packages/ui/drawer.module.css", ".drawer", "background")).toBe("var(--surface)");
  });

  it("are the shared radios, one kept, in a ruled list", () => {
    const picker = readFileSync(PICKER, "utf8");
    expect(picker).toContain("<Radio");
    expect(picker).toMatch(/<ChoiceGroup[^>]*ruled/);
  });

  it("are drawn in the ink, at 3:1 against the paper", () => {
    expect(valueOf("packages/ui/field.module.css", ".check", "accent-color")).toBe("var(--ui-strong)");
    expect(tokenRatio("--ui-strong", "--paper")).toBeGreaterThanOrEqual(3);
  });
});

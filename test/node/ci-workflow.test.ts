// What CI's own steps must keep to (.github/workflows/ci.yml). A step here that
// fails on a blip wastes a run; one that never fails checks nothing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CI = readFileSync(".github/workflows/ci.yml", "utf8");

/** A step's lines, from its `- name:` to the next step's. */
function step(name: string): string {
  const lines = CI.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`ci.yml has no step "${name}"`);
  const indent = lines[start]?.indexOf("-") ?? 0;
  const next = lines.findIndex(
    (line, index) => index > start && line.indexOf("- ") === indent && line.trim().startsWith("- "),
  );
  return lines.slice(start, next === -1 ? undefined : next).join("\n");
}

describe("the registry signatures step", () => {
  // npm now and then fails it with EMISSINGSIGNATUREKEY, a registry blip that a re-run clears.
  it("tries once more after a failure, and fails the step if the second try fails too", () => {
    const text = step("Registry signatures");
    expect(text.match(/npm audit signatures/g)).toHaveLength(2);
    expect(text).toMatch(/npm audit signatures \|\| \{[^}]*npm audit signatures; \}/);
    expect(text).not.toContain("|| true");
    expect(text).not.toContain("continue-on-error");
  });
});

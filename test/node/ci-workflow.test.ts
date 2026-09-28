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
  // npm now and then fails it with EMISSINGSIGNATUREKEY, a registry blip that a later try clears. On 28 September
  // 2026 a second try 15 seconds on failed three runs in a row.
  it("tries four times, half a minute apart, and fails the step if every try fails", () => {
    const text = step("Registry signatures");
    expect(text).toMatch(/for try in 1 2 3 4; do/);
    expect(text).toMatch(/if npm audit signatures; then exit 0; fi/);
    expect(text).toMatch(/sleep 30/);
    expect(text).toMatch(/done\n\s*exit 1\n/);
    expect(text).not.toContain("|| true");
    expect(text).not.toContain("continue-on-error");
  });
});

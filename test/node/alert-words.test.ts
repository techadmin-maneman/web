// Alerts reach ops, on the Tasks board and on WhatsApp, so each is an instruction in ops' words. An environment
// variable, a script, a repository path or an ADR number belongs in the structured log beside it (the 2 Oct audit,
// CP-29); the runbook is named by its section, as ops find it.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Each `message:` in the Worker's source, as written, with the values it fills in left out. */
function messages(): { where: string; text: string }[] {
  const files = execSync("git ls-files src", { encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".ts"));
  return files.flatMap((file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => {
      if (!/^\s+message:/.test(line)) return [];
      // Only a message written out here: one a function makes is read where that function writes it.
      const opening = /message:\s*$/.test(line) ? (lines[index + 1] ?? "") : line.replace(/^\s+message:\s*/, "");
      if (!/^\s*["'`]/.test(opening)) return [];
      // The message runs on until a line that closes it with a quote and a comma.
      const end = lines.findIndex((each, at) => at >= index && /["'`],\s*$/.test(each));
      const text = lines
        .slice(index, end === -1 ? index + 1 : end + 1)
        .join(" ")
        .replace(/\$\{[^}]*\}/g, "");
      return [{ where: `${file}:${String(index + 1)}`, text }];
    });
  });
}

describe("what an alert says", () => {
  const found = messages();

  it("reads every alert", () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it.each([
    ["an environment variable", /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/],
    ["a path in the repository", /\b(?:docs|scripts|src|migrations)\/\w/],
    ["an ADR's number", /\bADR \d/],
  ])("names no %s", (_, pattern) => {
    expect(found.filter((each) => pattern.test(each.text)).map((each) => each.where)).toEqual([]);
  });
});

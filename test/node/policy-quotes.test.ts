// The prompt says: "Encode each rule once, in src/policy/, with a unit test
// that quotes it." Each module there exports its RULES in the prompt's own
// words. This test holds them to that: every quote is in the prompt, and
// every rule under "Business rules, decided" is quoted by exactly one module.
// The behaviour behind each rule is tested next to it as its milestone lands.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROMPT = readFileSync("docs/prompts/phase2-backend.md", "utf8");

/** The words alone: markdown's emphasis and code marks removed, whitespace collapsed. */
function plain(text: string): string {
  return text
    .replace(/\*\*|\*|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Each line of the "Business rules, decided" section, without its bullet or bold label. */
function businessRules(): string[] {
  const section = PROMPT.split("## Business rules, decided")[1]?.split("\n## ")[0] ?? "";
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Encode each rule"))
    .map((line) => plain(line.replace(/^(- |\d+\. )/, "").replace(/^\*\*[^*]+\*\*\s*/, "")))
    .filter((line) => line !== "");
}

const policies = await Promise.all(
  readdirSync("src/policy")
    .filter((file) => file.endsWith(".ts"))
    .map(async (file) => {
      const name = file.replace(/\.ts$/, "");
      const module = (await import(`../../src/policy/${name}.ts`)) as { RULES?: readonly string[] };
      return { file, rules: module.RULES ?? [] };
    }),
);
const quoted = policies.flatMap((policy) => policy.rules);

describe("src/policy", () => {
  it.each(policies)("$file states its rules", ({ rules }) => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it.each(quoted)("quotes the prompt word for word: %s", (rule) => {
    expect(plain(PROMPT).includes(rule), "not in docs/prompts/phase2-backend.md").toBe(true);
  });

  it("quotes no rule twice", () => {
    expect(quoted.filter((rule, index) => quoted.indexOf(rule) !== index)).toEqual([]);
  });

  it("encodes every business rule the prompt lists", () => {
    const rules = businessRules();
    expect(rules.length).toBeGreaterThan(30);
    expect(rules.filter((rule) => !quoted.includes(rule))).toEqual([]);
  });
});

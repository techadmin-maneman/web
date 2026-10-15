// Every path the coverage floors name matches a file (vitest.config.ts): a floor on a path that moved enforces nothing.

import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** "src/domain/{a,b}.ts" → a file for each name in the braces: one brace group, as the floors use. */
function expand(pattern: string): string[] {
  const group = /\{([^}]+)\}/.exec(pattern);
  if (group === null) return [pattern];
  const [whole, names = ""] = group;
  return names.split(",").map((each) => pattern.replace(whole, each));
}

const floors = [
  ...readFileSync("vitest.config.ts", "utf8").matchAll(/^\s*"((?:src|scripts|apps)\/[^"]+)":\s*\{/gm),
].map((match) => match[1] ?? "");

describe("the coverage floors", () => {
  it("name some paths", () => {
    expect(floors.length).toBeGreaterThan(3);
  });

  it.each(floors)("%s matches a file for each name it lists", (floor) => {
    for (const path of expand(floor)) expect(globSync(path), path).not.toEqual([]);
  });
});

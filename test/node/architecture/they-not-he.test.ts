// A technician, a client or anyone else the code's words name is "they" (CONTRIBUTING.md, "Words"): in the alerts ops
// read, the API's descriptions, the apps' and the site's own words, and the tests' sample text alike.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const GENDERED = /\b(he|him|his|himself|she|her|hers|herself)\b/i;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;
/** A string on the line: what the code says to someone, not what it says to the next engineer. */
const STRING = /(["'`])(?:(?!\1).)*\1/g;

function gendered(text: string): string[] {
  return text.split("\n").flatMap((line, index) => {
    if (COMMENT.test(line)) return [];
    const strings = line.match(STRING) ?? [];
    return strings.some((words) => GENDERED.test(words)) ? [`${String(index + 1)}: ${line.trim().slice(0, 100)}`] : [];
  });
}

const files = execFileSync("git", ["ls-files", "src", "apps", "packages", "site/src", "e2e"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/(worker-configuration\.d|api-schema)\.ts$/.test(file));

describe("the words the code says to people", () => {
  it("know a gendered word in a string, and leave comments and other words alone", () => {
    expect(gendered('const said = "so he can sign in again";\n// he, in a comment\nconst the = "There";')).toEqual([
      '1: const said = "so he can sign in again";',
    ]);
  });

  it("name no one he or she", () => {
    expect(files.flatMap((file) => gendered(readFileSync(file, "utf8")).map((hit) => `${file}:${hit}`))).toEqual([]);
  });
});

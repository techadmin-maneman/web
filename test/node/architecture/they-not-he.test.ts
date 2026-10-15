// A technician, a client or anyone else the code's words name is "they" (CONTRIBUTING.md, "Words"): in the alerts ops
// read, the API's descriptions, the apps' and the site's own words, the tests' sample text and titles, and the docs.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** A pronoun, in a sentence's case: "HIS" in a piece's label is not one. */
const GENDERED = /\b([Hh]e|[Hh]im|[Hh]is|[Hh]imself|[Ss]he|[Hh]er|[Hh]ers|[Hh]erself)\b/;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;
/** A string on the line: what the code says to someone, not what it says to the next engineer. */
const STRING = /(["'`])(?:(?!\1).)*\1/g;
/** What a doc quotes, a design board's words or a word itself, which it does not say in its own voice. */
const QUOTED = /"[^"]*"|“[^”]*”|`[^`]*`/g;

function gendered(text: string): string[] {
  return text.split("\n").flatMap((line, index) => {
    if (COMMENT.test(line)) return [];
    const strings = line.match(STRING) ?? [];
    return strings.some((words) => GENDERED.test(words)) ? [`${String(index + 1)}: ${line.trim().slice(0, 100)}`] : [];
  });
}

/** A doc's own lines that name someone he or she, what it quotes left out. */
function genderedProse(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) =>
      GENDERED.test(line.replace(QUOTED, "")) ? [`${String(index + 1)}: ${line.trim().slice(0, 100)}`] : [],
    );
}

const tracked = (...paths: string[]) =>
  execFileSync("git", ["ls-files", ...paths], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const files = tracked("src", "apps", "packages", "site/src", "e2e", "test", "scripts").filter(
  (file) =>
    /\.(ts|tsx)$/.test(file) &&
    !/(worker-configuration\.d|api-schema)\.ts$/.test(file) &&
    file !== "test/node/architecture/they-not-he.test.ts" &&
    // Each holds this guard's own pattern, for the words it checks.
    file !== "test/node/apps/ops/ops-content.test.ts" &&
    file !== "test/node/apps/ops/ops-settings.test.ts",
);

/** The docs in their own voice: not the record of what was said and decided, kept word for word. */
const docs = tracked("docs", "README.md", "CONTRIBUTING.md").filter(
  (file) => file.endsWith(".md") && !/^docs\/(archive|prompts|decisions)\//.test(file),
);

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

describe("the docs", () => {
  it("know a gendered word in their own words, and leave what they quote alone", () => {
    expect(genderedProse('He signs in.\nWhere the board writes "his own app".\nThey sign in.')).toEqual([
      "1: He signs in.",
    ]);
  });

  it("name no one he or she", () => {
    expect(docs.flatMap((file) => genderedProse(readFileSync(file, "utf8")).map((hit) => `${file}:${hit}`))).toEqual(
      [],
    );
  });
});

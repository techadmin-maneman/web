// Comments say what the code does and why, never when it was decided or by whom (CONTRIBUTING.md, "Comments"): no
// design-board code, no "Phase 1" or "Phase 2", no ruling's date, and no "the owner". The history is in the ADRs,
// docs/open-points.md and git.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";

const KINDS = {
  "a design board": /\bboards? [A-H]\d\b/i,
  "a phase": /(?<!DLF )\bPhase [12]\b/,
  "a ruling's date": new RegExp(
    String.raw`\b(?:rul(?:ing|ed)|decision|decided|answer)s?\b[^.]{0,40}\b\d{1,2} (?:${MONTHS}) 20\d\d`,
    "i",
  ),
  "the owner": /\bthe owner\b/i,
} as const;

const FOLDERS = ["src", "apps", "packages", "site/src", "scripts", "test", "e2e"];
const CODE = /\.(ts|tsx|astro|mjs|css)$/;
/** The fidelity pairs compare each screen with the design frame its board code names. */
const PAIRING = "scripts/fidelity/";
const COMMENT = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

function covered(): string[] {
  const tracked = execFileSync("git", ["ls-files", ...FOLDERS], { encoding: "utf8" }).split("\n");
  return tracked.filter(
    (file) =>
      CODE.test(file) &&
      !file.startsWith(PAIRING) &&
      !file.endsWith("api-schema.ts") &&
      !file.endsWith("worker-configuration.d.ts") &&
      file !== "test/node/architecture/no-history.test.ts",
  );
}

/** Each comment line of the text that carries history, as "line: kind". */
function historyIn(text: string): string[] {
  return text.split("\n").flatMap((line, index) => {
    if (!COMMENT.test(line)) return [];
    return Object.entries(KINDS)
      .filter(([, pattern]) => pattern.test(line))
      .map(([kind]) => `${String(index + 1)}: ${kind}`);
  });
}

describe("comments", () => {
  it("know history when they see it, and leave the rest alone", () => {
    expect(
      historyIn("// Ten minutes (board C4).\n// As the owner ruled on 27 September 2026.\n// Phase 2's apps."),
    ).toEqual(["1: a design board", "2: a ruling's date", "2: the owner", "3: a phase"]);
    expect(historyIn("const area = 'DLF Phase 1'; // the day's money\n// ops ruled on the charge")).toEqual([]);
    expect(historyIn('const label = "Ask the owner to add you.";')).toEqual([]);
  });

  it("carry no history", () => {
    const found = covered().flatMap((file) => historyIn(readFileSync(file, "utf8")).map((hit) => `${file}:${hit}`));
    expect(found).toEqual([]);
  });
});

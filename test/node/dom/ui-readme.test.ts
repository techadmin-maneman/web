// packages/ui/README.md names every part the package exports, so a new screen finds what to draw with before it draws
// its own: five exports were missing from it, ErrorRef and ScanField among them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const exported = Object.keys(
  (JSON.parse(readFileSync("packages/ui/package.json", "utf8")) as { exports: Record<string, string> }).exports,
).map((path) => path.replace(/^\.\//, ""));
const readme = readFileSync("packages/ui/README.md", "utf8");

describe("the shared package's README", () => {
  it("names every export, in its table", () => {
    expect(exported.filter((name) => !readme.includes(`\`@maneman/ui/${name}\``))).toEqual([]);
  });

  it("says which pattern a new screen uses for saving, deleting, an empty list, an error and a status", () => {
    const patterns = readme.slice(readme.indexOf("## Patterns"));
    for (const pattern of ["Saving", "Deleting", "Nothing to show", "An error", "A status", "A chosen option"]) {
      expect(patterns, pattern).toContain(pattern);
    }
  });
});

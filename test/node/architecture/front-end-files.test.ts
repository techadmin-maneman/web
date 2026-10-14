// How the front ends' files read to someone opening one for the first time: every import at the top, before any code,
// a hook's file named as the hook is, `useDays.ts` and never `use-days.ts`, and the console's headers short.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const files = execFileSync("git", ["ls-files", "apps", "packages", "site/src"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => /^(apps\/[^/]+\/(src|sw)|packages|site\/src)\//.test(file))
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts") && !file.includes("api-schema"));

/** The line of each import that comes after code, as "file:line". */
function importsAfterCode(file: string): string[] {
  const late: string[] = [];
  let inImport = false;
  let code = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const trimmed = line.trim();
      const opensImport = /^(import|export\s+(\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from|export\s+(type\s+)?\{)/.test(
        trimmed,
      );
      if (inImport) {
        if (trimmed.endsWith(";")) inImport = false;
        return;
      }
      if (/^import\s/.test(trimmed) && code) late.push(`${file}:${String(index + 1)}`);
      if (opensImport) {
        if (!trimmed.endsWith(";")) inImport = true;
        return;
      }
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
      code = true;
    });
  return late;
}

describe("the front ends' files", () => {
  it("import everything before any code", () => {
    expect(files.flatMap(importsAfterCode)).toEqual([]);
  });

  it("name a hook's file as the hook is named", () => {
    expect(files.filter((file) => /\/use-[a-z-]+\.tsx?$/.test(file))).toEqual([]);
  });

  // A header says what the file is for and why, with its decision's link; the rest belongs beside the code it explains.
  it("open, in the console, with a header of four lines at most", () => {
    const header = (file: string) => {
      const lines = readFileSync(file, "utf8").split("\n");
      const end = lines.findIndex((line) => !line.startsWith("//"));
      return end === -1 ? lines.length : end;
    };
    expect(files.filter((file) => file.startsWith("apps/ops/src/") && header(file) > 4)).toEqual([]);
  });
});

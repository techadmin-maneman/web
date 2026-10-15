// A script runs in plain Node (node scripts/…/x.ts), which knows nothing of the front ends' "@rules/…" alias. So no
// module a script imports, however far down, may use it: the local seed's e2e helpers once imported the site's copy,
// and the seed stopped loading. A script that needs copy loads it through Vite, as scripts/build/generate-words.ts does.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** The scripts a person or a workflow runs: every file under scripts/ but its shared modules. */
const ENTRIES = readdirSync("scripts", { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "lib")
  .flatMap((entry) =>
    readdirSync(`scripts/${entry.name}`)
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `scripts/${entry.name}/${file}`),
  );

/** The modules a file imports when it runs: relative ones resolved, and every specifier as written. */
function importsOf(file: string): { local: string[]; specifiers: string[] } {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    const declaration = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) ? statement : null;
    const named = declaration?.moduleSpecifier;
    if (declaration === null || named === undefined || !ts.isStringLiteral(named)) continue;
    const typeOnly = ts.isImportDeclaration(declaration)
      ? declaration.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      : declaration.isTypeOnly;
    if (!typeOnly) specifiers.push(named.text);
  }
  const local = specifiers
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
    .filter((resolved) => resolved.endsWith(".ts") && existsSync(resolved));
  return { local, specifiers };
}

/** Each module reached from `entry` that imports through the alias, with the chain that reached it. */
function aliasedFrom(entry: string): string[] {
  const seen = new Set<string>([entry]);
  const queue: { file: string; chain: string[] }[] = [{ file: entry, chain: [entry] }];
  const found: string[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { local, specifiers } = importsOf(next.file);
    if (specifiers.some((specifier) => specifier.startsWith("@rules/"))) found.push(next.chain.join(" → "));
    for (const file of local.filter((each) => !seen.has(each))) {
      seen.add(file);
      queue.push({ file, chain: [...next.chain, file] });
    }
  }
  return found;
}

describe("a script run in plain Node", () => {
  it("has scripts to check", () => {
    expect(ENTRIES.length).toBeGreaterThan(20);
  });

  it.each(ENTRIES)("%s imports nothing that needs the front ends' alias", (entry) => {
    expect(aliasedFrom(entry)).toEqual([]);
  });
});

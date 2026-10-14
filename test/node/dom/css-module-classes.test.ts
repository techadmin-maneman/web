// Every class a screen reads from a CSS module is one that module defines. A module hands back undefined for a class
// it lacks, and TypeScript types every module as a record of strings, so a missing class renders nothing and fails
// nothing: panels went unstyled that way. Each `name.class` is checked whose `name` is the module's own import.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path/posix";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "packages/ui", "site/src"];

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The classes a stylesheet defines. */
function classesOf(path: string): Set<string> {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ""));
}

const stylesheetOf = (file: string, from: string) =>
  from.startsWith(".") ? normalize(join(dirname(file), from)) : from.replace("@maneman/ui/", "packages/ui/");

/** Each class read from a module that does not define it, as "file: module.class". */
function missingIn(program: ts.Program, file: string): string[] {
  const source = program.getSourceFile(file);
  if (source === undefined) return [];
  const checker = program.getTypeChecker();
  const modules = new Map<ts.Symbol, { readonly name: string; readonly defined: Set<string> | null }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const from = statement.moduleSpecifier.text;
    const binding = statement.importClause?.name;
    if (!from.endsWith(".module.css") || binding === undefined) continue;
    const symbol = checker.getSymbolAtLocation(binding);
    const path = stylesheetOf(file, from);
    if (symbol !== undefined)
      modules.set(symbol, { name: binding.text, defined: existsSync(path) ? classesOf(path) : null });
  }
  if (modules.size === 0) return [];
  const missing = new Set<string>();
  const visit = (node: ts.Node): void => {
    const read = ts.isPropertyAccessExpression(node)
      ? { object: node.expression, key: node.name.text }
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? { object: node.expression, key: node.argumentExpression.text }
        : null;
    if (read !== null && ts.isIdentifier(read.object)) {
      const symbol = checker.getSymbolAtLocation(read.object);
      const module = symbol === undefined ? undefined : modules.get(symbol);
      if (module !== undefined && module.defined?.has(read.key) !== true)
        missing.add(`${file}: ${module.name}.${read.key}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...missing];
}

/**
 * What each stylesheet's importers read of it: its classes by name, or `any` where one reads it by a computed name. A
 * rule left behind when its class moved to another sheet matches nothing, and reads as nothing here.
 */
function readsOf(files: readonly string[]): Map<string, { keys: Set<string>; any: boolean }> {
  const reads = new Map<string, { keys: Set<string>; any: boolean }>();
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const names = new Map<string, string>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const binding = statement.importClause?.name;
      if (statement.moduleSpecifier.text.endsWith(".module.css") && binding !== undefined)
        names.set(binding.text, stylesheetOf(file, statement.moduleSpecifier.text));
    }
    const visit = (node: ts.Node): void => {
      const object = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
      const path = object !== null && ts.isIdentifier(object) ? names.get(object.text) : undefined;
      if (path !== undefined) {
        const read = reads.get(path) ?? { keys: new Set<string>(), any: false };
        if (ts.isPropertyAccessExpression(node)) read.keys.add(node.name.text);
        else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression))
          read.keys.add(node.argumentExpression.text);
        else read.any = true;
        reads.set(path, read);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return reads;
}

describe("the CSS modules", () => {
  it.each(ROOTS)("define every class %s reads from them", (root) => {
    const files = filesUnder(root);
    const program = ts.createProgram(files, { noResolve: true, noLib: true, jsx: ts.JsxEmit.Preserve, types: [] });
    expect(files.flatMap((file) => missingIn(program, file))).toEqual([]);
  });

  it("define, in the console, no class that nothing reads", () => {
    const reads = readsOf(filesUnder("apps/ops/src"));
    const unread = [...reads].flatMap(([path, read]) =>
      read.any ? [] : [...classesOf(path)].filter((name) => !read.keys.has(name)).map((name) => `${path}: .${name}`),
    );
    expect(unread).toEqual([]);
  });
});

// The words the front ends show keep one typography: a curly apostrophe in every string of the site, the apps and the
// shared packages (the WhatsApp texts, src/config/message-templates.ts, keep a straight one, as WhatsApp shows it), and
// a label for something under way ending in "…". Comments are free to write as they like: only strings are read.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = ["apps/app/src", "apps/ops/src", "apps/tech/src", "site/src", "packages/ui", "packages/web-kit"];

/** The keys a label for something under way goes by: "Saving…", "Sending…". */
const UNDER_WAY = new Set(["saving", "sending", "loading", "deleting", "erasing", "uploading", "confirming"]);

const STRAIGHT = /(?<=[A-Za-z])'(?=[A-Za-z])/;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || name === "dist") return [];
    const path = join(directory, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") && !name.includes("api-schema") ? [path] : [];
  });
}

/** Each string in a file, a template's parts and JSX text among them, with the property it is the value of. */
function stringsOf(path: string): { readonly text: string; readonly key: string | null; readonly line: number }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: { text: string; key: string | null; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const owner = node.parent;
      const imported = ts.isImportDeclaration(owner) || ts.isExportDeclaration(owner);
      const key = ts.isPropertyAssignment(owner) ? owner.name.getText(source).replace(/["']/g, "") : null;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (!imported) found.push({ text: node.getText(source), key, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const strings = ROOTS.flatMap(filesUnder).flatMap((path) => stringsOf(path).map((each) => ({ ...each, path })));

describe("the front ends' words", () => {
  it("are read", () => {
    expect(strings.length).toBeGreaterThan(5000);
  });

  it("write a curly apostrophe", () => {
    const straight = strings.filter((each) => STRAIGHT.test(each.text));
    expect(straight.map((each) => `${each.path}:${String(each.line)} ${each.text.slice(0, 60)}`)).toEqual([]);
  });

  it("end a label for something under way in an ellipsis", () => {
    const bare = strings.filter(
      (each) => each.key !== null && UNDER_WAY.has(each.key) && /^"[A-Z]/.test(each.text) && !each.text.endsWith('…"'),
    );
    expect(bare.map((each) => `${each.path}:${String(each.line)} ${each.key ?? ""}: ${each.text}`)).toEqual([]);
  });
});

// No figure in the client app's words (docs/client-redesign/PLAN.md, decision 7): every price and every count of hours,
// days or years is read from the API, never written into apps/app/src. Comments may give examples; the words the client
// reads may not. Refunds' working days are Razorpay's, not a rule ops set, and are said once (content/payments.ts).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = "apps/app/src";
/** The API's own document, generated: its descriptions are the server's. */
const GENERATED = new Set(["api-schema.ts"]);
const ALLOWED = new Set(["content/payments.ts: 7 working days"]);
const FIGURE = /Rs\.\s*\d|\b\d+\s+(?:working\s+)?(?:hours?|days?|years?)\b/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The text of each string, template part and JSX text in a file: what can reach the screen. */
function wordsIn(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) found.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the client app's words", () => {
  it("carry no price and no count of hours, days or years", () => {
    const figures = filesUnder(ROOT).flatMap((path) => {
      const file = relative(ROOT, path).replace(/\\/g, "/");
      if (GENERATED.has(file)) return [];
      return wordsIn(path)
        .map((text) => FIGURE.exec(text)?.[0])
        .filter((figure): figure is string => figure !== undefined)
        .map((figure) => `${file}: ${figure}`)
        .filter((found) => !ALLOWED.has(found));
    });
    expect(figures).toEqual([]);
  });
});

// The client reads one word for each thing (docs/glossary.md, "The client's words"): what the site, the app's content
// and the WhatsApp messages say. A consent notice keeps the words its version was published in, and the legal pages,
// in counsel's words, may say "photograph", "simulation" and the terms' "Mane Man Credits". Only prose is read: a
// string with a space in it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { NOTICES } from "../../../src/config/notices.ts";

const ROOTS = ["apps/app/src/content", "site/src/content", "packages/web-kit"];
const MESSAGES = "src/config/message-templates.ts";
const LEGAL = new Set(
  ["privacy-policy", "terms-and-conditions", "aftercare", "offer-terms"].map(
    (page) => `site/src/content/site/${page}.ts`,
  ),
);

/** Each word the client never reads, with the one they do. */
const NOT_SAID: readonly { readonly word: RegExp; readonly say: string; readonly legalMay?: true }[] = [
  { word: /\bcredits?\b/i, say: "free service visit", legalMay: true },
  { word: /\bno-show|\bnot home\b/i, say: "missed visit" },
  { word: /\bhouse (example|sample)|\bour example\b|\bA Mane Man example\b/i, say: "the Mane Man example card" },
  { word: /\brevoke/i, say: "switch off" },
  { word: /\bmonthly (service|visit)/i, say: "service visit, every month" },
  { word: /\bphotograph/i, say: "photo", legalMay: true },
  { word: /\bsimulation/i, say: "look", legalMay: true },
];

const noticeLines = new Set(NOTICES.flatMap((notice) => notice.text));

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name).replaceAll("\\", "/");
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : filesUnder(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The prose in a file: each string or template part with a space in it, and its line. */
function proseOf(path: string): { readonly text: string; readonly line: number }[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
      const { text } = node;
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (text.includes(" ") && !ts.isImportDeclaration(node.parent)) found.push({ text, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const prose = [...ROOTS.flatMap(filesUnder), MESSAGES].flatMap((path) =>
  proseOf(path)
    .filter((each) => !noticeLines.has(each.text))
    .map((each) => ({ ...each, path })),
);

describe("the client's words", () => {
  it("are read", () => {
    expect(prose.length).toBeGreaterThan(1000);
  });

  it.each(NOT_SAID.map((rule) => [rule.say, rule] as const))("say %s", (_, rule) => {
    const said = prose.filter((each) => rule.word.test(each.text) && !(rule.legalMay === true && LEGAL.has(each.path)));
    expect(said.map((each) => `${each.path}:${String(each.line)} ${each.text.slice(0, 80)}`)).toEqual([]);
  });
});

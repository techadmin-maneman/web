// What goes into the texts file the owner marks up (docs/open-points.md, items 39, 41 and 42): every WhatsApp
// message's text, and every line of copy the source marks PLACEHOLDER, each with an id that finds it again, so the
// owner's wording can be committed back by hand. The consent notices are listed, not offered for editing: which
// words a person agreed to is a legal record, and counsel's (docs/decisions/0061-ops-editable-inputs.md).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface MessageText {
  /** The template's name, which finds it in src/config/message-templates.ts. */
  readonly name: string;
  readonly text: string;
  /** The comment written above it: when it is sent, and what its {{n}} stand for. Empty where there is none. */
  readonly note: string;
}

export interface PlaceholderText {
  /** The file and line of its PLACEHOLDER mark, which finds it again. */
  readonly id: string;
  /** Why it is a placeholder, as the mark says. */
  readonly note: string;
  /** The copy below the mark, as the source holds it. */
  readonly source: string;
}

/**
 * Each template's text with the comment above it. `source` is message-templates.ts itself: its comments are read
 * from it, and its texts from `templates`, the module's own record, so a text is never parsed out of TypeScript.
 */
export function messageTexts(templates: Readonly<Record<string, string>>, source: string): MessageText[] {
  const lines = source.split("\n");
  return Object.entries(templates).map(([name, text]) => {
    const at = lines.findIndex((line) => line.trimStart().startsWith(`${name}:`));
    return { name, text, note: commentAbove(lines, at) };
  });
}

/** The // comment lines just above line `at`, joined; empty where there are none. */
function commentAbove(lines: readonly string[], at: number): string {
  const comment: string[] = [];
  for (let i = at - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line.startsWith("//")) break;
    comment.unshift(line.replace(/^\/\/\s?/, ""));
  }
  return comment.join(" ");
}

/** A line whose PLACEHOLDER is about the copy below it, not a word in code or prose about placeholders. */
const MARK = /(\/\/|\*|\{\/\*|<!--)\s*.*\bPLACEHOLDER\b/;

/**
 * Every PLACEHOLDER mark in `files`, with the comment it opens and the copy below it: the lines up to the first that
 * ends an entry (a comma, a semicolon or a closing tag), at most eight.
 */
export function placeholderTexts(files: readonly { path: string; source: string }[]): PlaceholderText[] {
  const found: PlaceholderText[] = [];
  for (const { path, source } of files) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (!MARK.test(line)) return;
      const note: string[] = [];
      let i = index;
      while (i < lines.length && isComment(lines[i] ?? "")) {
        note.push(stripComment(lines[i] ?? ""));
        i += 1;
      }
      const copy: string[] = [];
      while (i < lines.length && copy.length < 8) {
        const next = lines[i] ?? "";
        copy.push(next.trim());
        i += 1;
        if (/[,;]\s*$|\/>\s*$|<\/\w+>\s*$/.test(next)) break;
      }
      found.push({ id: `${path}:${String(index + 1)}`, note: note.join(" "), source: copy.join("\n") });
    });
  }
  return found;
}

const isComment = (line: string): boolean => /^\s*(\/\/|\*|\/\*|\{\/\*|<!--)/.test(line);
const stripComment = (line: string): string =>
  line
    .trim()
    .replace(/^(\/\/|\/\*\*?|\*\/?|\{\/\*|<!--)\s?/, "")
    .replace(/(\*\/\}?|-->)$/, "")
    .trim();

/** The files whose copy the owner words: each surface's content, the site's pages and the config's lines. */
export function copyFiles(root: string): { path: string; source: string }[] {
  const paths = [
    "apps/app/src/content.ts",
    ...filesUnder(root, "apps/app/src/content", [".ts"]),
    "apps/ops/src/content.ts",
    ...filesUnder(root, "apps/ops/src/content", [".ts"]),
    "apps/tech/src/content.ts",
    ...filesUnder(root, "site/src/content", [".ts"]),
    ...filesUnder(root, "site/src/components", [".astro"]),
    ...filesUnder(root, "src/config", [".ts"]).filter(
      (path) => !path.endsWith("notices.ts") && !path.endsWith("message-templates.ts"),
    ),
  ];
  return paths.map((path) => ({ path, source: readFileSync(join(root, path), "utf8") }));
}

function filesUnder(root: string, dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) found.push(...filesUnder(root, path, extensions));
    else if (extensions.some((extension) => name.endsWith(extension))) found.push(path);
  }
  return found.sort();
}

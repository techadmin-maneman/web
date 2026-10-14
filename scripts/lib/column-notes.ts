// What each column means, as the migrations say it: the comment on a column's own line of its CREATE TABLE, or the
// comment lines just above it, or above an ALTER TABLE that adds it. A later comment on the same column is the one
// kept, and a column renamed, or a table renamed, takes its comment with it (docs/schema.md, scripts/lib/schema-doc.ts).

import type { MigrationFile } from "./schema-doc.ts";

/** The words of comment lines, as one sentence's worth: their `--` and indents gone, the lines joined. */
const joined = (lines: readonly string[]): string =>
  lines
    .map((line) => line.replace(/^\s*--\s?/, "").trim())
    .filter((line) => line !== "")
    .join(" ");

/** The table constraints a CREATE TABLE's line may open with, which are not columns. */
const CONSTRAINT = /^\s*(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;
const COLUMN_LINE = /^\s*"?([a-z_][a-z0-9_]*)"?\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)\b/i;

/** Each table's columns' notes in one CREATE TABLE's body. */
function createNotes(table: string, body: string, notes: Map<string, string>): void {
  let above: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*--/.test(line)) {
      above.push(line);
      continue;
    }
    const column = COLUMN_LINE.exec(line);
    if (column !== null && !CONSTRAINT.test(line)) {
      const trailing = /--(.*)$/.exec(line)?.[1]?.trim() ?? "";
      const note = trailing !== "" ? trailing : joined(above);
      if (note !== "") notes.set(`${table}.${(column[1] ?? "").toLowerCase()}`, note);
    }
    above = [];
  }
}

/** The comment block right above `index` in `sql`. */
function commentAbove(sql: string, index: number): string {
  const lines = sql.slice(0, index).split("\n");
  lines.pop();
  const block: string[] = [];
  while (lines.length > 0 && /^\s*--/.test(lines.at(-1) ?? "")) block.unshift(lines.pop() ?? "");
  return joined(block);
}

export function columnNotes(migrations: readonly MigrationFile[]): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const { sql } of migrations) {
    for (const match of sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\n\);/gi,
    )) {
      createNotes((match[1] ?? "").toLowerCase(), match[2] ?? "", notes);
    }
    for (const match of sql.matchAll(/ALTER TABLE\s+"?([a-z_][a-z0-9_]*)"?\s+ADD COLUMN\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      const note = commentAbove(sql, match.index);
      if (note !== "") notes.set(`${(match[1] ?? "").toLowerCase()}.${(match[2] ?? "").toLowerCase()}`, note);
    }
    for (const match of sql.matchAll(
      /ALTER TABLE\s+"?([a-z_][a-z0-9_]*)"?\s+RENAME COLUMN\s+"?(\w+)"?\s+TO\s+"?(\w+)"?/gi,
    )) {
      const [, table = "", from = "", to = ""] = match;
      const note = notes.get(`${table}.${from}`);
      if (note !== undefined) notes.set(`${table}.${to}`, note);
    }
    for (const match of sql.matchAll(/ALTER TABLE\s+"?([a-z_][a-z0-9_]*)"?\s+RENAME TO\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      const [, from = "", to = ""] = match;
      for (const [key, note] of [...notes]) {
        if (key.startsWith(`${from}.`)) notes.set(`${to}.${key.slice(from.length + 1)}`, note);
      }
    }
  }
  return notes;
}

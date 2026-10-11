// The Words page's lines (docs/decisions/0126-the-words-page.md): each with the wording in force, and every wording it
// has had. A change is checked (src/policy/word-checks.ts) and written with its audit entry, which keeps the line's
// key, never its words. Going back to an earlier wording, or to the code's, is a change like any other.

import { longestOf, wordRefusal, type WordRefusal } from "../../policy/word-checks.ts";
import { auditStatement, type AuditActor } from "../ops/audit.ts";
import { WORD_LINES, wordLine, type WordLine } from "./catalogue.ts";

export interface Word extends WordLine {
  /** The wording in force: the one ops set, else the code's. */
  readonly now: string;
  /** Who set the wording in force, and when; null while it is the code's. */
  readonly changed: { readonly by: string; readonly at: string } | null;
  /** The longest the line may grow. */
  readonly longest: number;
}

interface VersionRow {
  readonly key: string;
  readonly text: string | null;
  readonly set_by: string;
  readonly set_at: string;
}

/** Who set the wording in force, and when; null while it is the code's. */
function changedOf(row: VersionRow | undefined): Word["changed"] {
  if (row === undefined) return null;
  return row.text === null ? null : { by: row.set_by, at: row.set_at };
}

const wordOf = (line: WordLine, row: VersionRow | undefined): Word => ({
  ...line,
  now: row?.text ?? line.text,
  changed: changedOf(row),
  longest: longestOf(line.text),
});

/** The newest version of each line that has one. */
const NEWEST = `SELECT key, text, set_by, set_at FROM (
    SELECT key, text, set_by, set_at, ROW_NUMBER() OVER (PARTITION BY key ORDER BY set_at DESC, rowid DESC) AS n
    FROM word_versions
  ) WHERE n = 1`;

/** Every line, with the wording in force. */
export async function listWords(db: D1Database): Promise<Word[]> {
  const { results } = await db.prepare(NEWEST).all<VersionRow>();
  const newest = new Map(results.map((row) => [row.key, row]));
  return WORD_LINES.map((line) => wordOf(line, newest.get(line.key)));
}

/** One line, with the wording in force. */
async function wordAt(db: D1Database, line: WordLine): Promise<Word> {
  const row = await db
    .prepare("SELECT key, text, set_by, set_at FROM word_versions WHERE key = ?1 ORDER BY set_at DESC, rowid DESC")
    .bind(line.key)
    .first<VersionRow>();
  return wordOf(line, row ?? undefined);
}

export interface WordVersion {
  readonly id: string;
  /** Null where the line went back to the code's wording. */
  readonly text: string | null;
  readonly set_by: string;
  readonly set_at: string;
}

/** Every wording a line has had, newest first; empty for a line never changed. */
export async function wordHistory(db: D1Database, key: string): Promise<WordVersion[] | null> {
  if (wordLine(key) === undefined) return null;
  const { results } = await db
    .prepare("SELECT id, text, set_by, set_at FROM word_versions WHERE key = ?1 ORDER BY set_at DESC, rowid DESC")
    .bind(key)
    .all<WordVersion>();
  return results;
}

export type WordSet =
  { readonly outcome: "set"; readonly word: Word } | { readonly outcome: WordRefusal | "not_found" };

/** A line given a new wording, or put back to the code's with `text` null; checked first, and audited. */
export async function setWord(
  db: D1Database,
  change: {
    readonly key: string;
    readonly text: string | null;
    readonly actor: AuditActor;
    readonly requestId: string;
    readonly now: Date;
  },
): Promise<WordSet> {
  const line = wordLine(change.key);
  if (line === undefined) return { outcome: "not_found" };
  const text = change.text === null || change.text === line.text ? null : change.text;
  if (text !== null) {
    const refused = wordRefusal(text, line.text, line.surface);
    if (refused !== null) return { outcome: refused };
  }
  const at = change.now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO word_versions (id, key, text, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(crypto.randomUUID(), line.key, text, change.actor.id, at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "word.set",
        subject: { kind: "word", id: line.key },
        requestId: change.requestId,
        detail: { surface: line.surface, back_to_code: text === null },
      },
      change.now,
    ),
  ]);
  return { outcome: "set", word: await wordAt(db, line) };
}

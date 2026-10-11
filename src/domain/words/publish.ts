// Publishing the site's words (docs/decisions/0127-publishing-the-words.md): every line of the site changed on the
// Words page, as it stands, kept as one publish, which each build of this environment's site lays over its copy until
// the next. Staging rebuilds its site within minutes of a publish; production takes its words with its next release.

import { auditStatement, type AuditActor } from "../ops/audit.ts";
import { listWords } from "./words.ts";

/** What the site's builds lay over the copy: each changed line's key and words. */
type SiteWords = Readonly<Record<string, string>>;

export interface SitePublish {
  readonly id: string;
  readonly words: SiteWords;
  readonly lines: number;
  readonly published_by: string;
  readonly published_at: string;
}

interface PublishRow {
  readonly id: string;
  readonly words: string;
  readonly lines: number;
  readonly published_by: string;
  readonly published_at: string;
}

/** The site's words as the latest publish left them; null before any publish. */
export async function latestPublish(db: D1Database): Promise<SitePublish | null> {
  const row = await db
    .prepare(
      `SELECT id, words, lines, published_by, published_at FROM site_word_publishes
       ORDER BY published_at DESC, rowid DESC LIMIT 1`,
    )
    .first<PublishRow>();
  if (row === null) return null;
  return { ...row, words: JSON.parse(row.words) as SiteWords };
}

/** Publishes every line of the site changed on the Words page, as it stands now, with its audit entry. */
export async function publishSite(
  db: D1Database,
  change: { readonly actor: AuditActor; readonly requestId: string; readonly now: Date },
): Promise<SitePublish> {
  const words: SiteWords = Object.fromEntries(
    (await listWords(db))
      .filter((word) => word.surface === "site" && word.changed !== null)
      .map((word) => [word.key, word.now]),
  );
  const publish: SitePublish = {
    id: crypto.randomUUID(),
    words,
    lines: Object.keys(words).length,
    published_by: change.actor.id,
    published_at: change.now.toISOString(),
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO site_word_publishes (id, words, lines, published_by, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(publish.id, JSON.stringify(words), publish.lines, publish.published_by, publish.published_at),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "word.publish",
        subject: { kind: "site_word_publish", id: publish.id },
        requestId: change.requestId,
        detail: { lines: publish.lines },
      },
      change.now,
    ),
  ]);
  return publish;
}

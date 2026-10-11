// Saved answers for the Care inbox (docs/decisions/0141-quick-replies.md): a Customer Care manager adds and retires
// them; Care pick one in a chat, and the console fills in {name} and {next_visit} before it is sent. Each change is
// audited.

import { auditStatement, type AuditActor } from "../ops/audit.ts";

export interface QuickReply {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

interface Change {
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/** The answers on the list now, by title. */
export async function quickReplies(db: D1Database): Promise<QuickReply[]> {
  const { results } = await db
    .prepare("SELECT id, title, text FROM quick_replies WHERE retired_at IS NULL ORDER BY title, created_at")
    .all<QuickReply>();
  return results;
}

export async function addQuickReply(
  db: D1Database,
  change: Change & { readonly title: string; readonly text: string },
): Promise<QuickReply> {
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO quick_replies (id, title, text, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, change.title, change.text, change.actor.id, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "quick_reply.add",
        subject: { kind: "quick_reply", id },
        requestId: change.requestId,
        detail: { title: change.title },
      },
      change.now,
    ),
  ]);
  return { id, title: change.title, text: change.text };
}

/** Takes an answer off the list; false for one not on it. */
export async function retireQuickReply(db: D1Database, change: Change & { readonly id: string }): Promise<boolean> {
  const listed = await db
    .prepare("SELECT 1 FROM quick_replies WHERE id = ?1 AND retired_at IS NULL")
    .bind(change.id)
    .first();
  if (listed === null) return false;
  await db.batch([
    db.prepare("UPDATE quick_replies SET retired_at = ?2 WHERE id = ?1").bind(change.id, change.now.toISOString()),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "quick_reply.retire",
        subject: { kind: "quick_reply", id: change.id },
        requestId: change.requestId,
      },
      change.now,
    ),
  ]);
  return true;
}

// A member of staff opening a client's photographs: "a locked photograph view
// that writes the audit entry before returning any URL"
// (docs/prompts/phase2-backend.md; docs/decisions/0031-access-and-audit.md).
//
// One opening is one entry in the audit log, written before any image leaves,
// at the server's time. The images shown in that opening are then served for
// PHOTO_VIEW_MINUTES without another entry: the entry is the view. It once
// wrote one for every image, ten for a visit and ten more on every return to
// the tab, and the console lettered the browser's clock as the time logged.

import { recordAudit, type AuditActor } from "./audit.ts";

/** How long one logged opening covers the photographs shown in it. */
export const PHOTO_VIEW_MINUTES = 30;

/** How many earlier openings the console lists beside the photographs. */
const EARLIER_SHOWN = 10;

const VIEWS_OF = "action = 'photo.view' AND subject_kind = 'person' AND subject_id = ?1";

export interface PhotoView {
  /** The member of staff, by their Access e-mail, or a service token by its ID. */
  readonly by: string;
  readonly at: string;
}

/** Writes the opening's entry. A failure throws, and then nothing may be shown. */
export async function logPhotoView(
  db: D1Database,
  view: { readonly personId: string; readonly actor: AuditActor; readonly requestId: string; readonly now: Date },
): Promise<void> {
  await recordAudit(
    db,
    {
      surface: "ops",
      actor: view.actor,
      action: "photo.view",
      subject: { kind: "person", id: view.personId },
      requestId: view.requestId,
    },
    view.now,
  );
}

/** Whether this member of staff has an opening of this client's photographs still in force. */
export async function viewInForce(db: D1Database, personId: string, actor: AuditActor, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - PHOTO_VIEW_MINUTES * 60_000).toISOString();
  const row = await db
    .prepare(`SELECT 1 FROM audit_log WHERE ${VIEWS_OF} AND actor_kind = ?2 AND actor = ?3 AND at > ?4 LIMIT 1`)
    .bind(personId, actor.kind, actor.id, since)
    .first();
  return row !== null;
}

/** Who opened this client's photographs before `now`, the latest first. */
export async function earlierViews(db: D1Database, personId: string, now: Date): Promise<PhotoView[]> {
  const { results } = await db
    .prepare(`SELECT actor, at FROM audit_log WHERE ${VIEWS_OF} AND at < ?2 ORDER BY at DESC LIMIT ?3`)
    .bind(personId, now.toISOString(), EARLIER_SHOWN)
    .all<{ actor: string; at: string }>();
  return results.map((row) => ({ by: row.actor, at: row.at }));
}

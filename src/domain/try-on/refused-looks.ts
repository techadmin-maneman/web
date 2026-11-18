// A look WhatsApp refused (docs/decisions/0276-a-message-whatsapp-refuses.md), shown once in the client app: the first
// time the client opens it after the refusal, the app takes them to Photos, where the look is, and says so here, so
// it happens once. Only a look still held, made for the client's own proved number, is shown.

/** The client's latest refused look still held and not yet shown in the app; null for none. */
export async function lookToShow(db: D1Database, personId: string, now: Date): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT j.id FROM tryon_jobs j INDEXED BY tryon_jobs_by_person
        WHERE j.person_id = ?1 AND j.number_proved_at IS NOT NULL AND j.look_shown_at IS NULL
          AND (j.kept_look_key IS NOT NULL OR (j.state = 'ready' AND j.result_key IS NOT NULL AND j.expires_at > ?2))
          AND EXISTS (SELECT 1 FROM outbound_messages m INDEXED BY outbound_messages_by_subject
                       WHERE m.subject_id = j.id AND m.kind = 'tryon_result' AND m.state = 'failed'
                         AND m.provider_message_id IS NOT NULL)
        ORDER BY j.created_at DESC LIMIT 1`,
    )
    .bind(personId, now.toISOString())
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** The look shown: false for a try-on that is not the client's, or was shown already. */
export async function markLookShown(db: D1Database, personId: string, jobId: string, now: Date): Promise<boolean> {
  const result = await db
    .prepare("UPDATE tryon_jobs SET look_shown_at = ?3 WHERE id = ?1 AND person_id = ?2 AND look_shown_at IS NULL")
    .bind(jobId, personId, now.toISOString())
    .run();
  return result.meta.changes > 0;
}

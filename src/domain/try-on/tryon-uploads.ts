// A try-on's photograph coming in (docs/decisions/0014-try-on-api.md): the job made as the link is asked for, and the
// one write the photograph gets, and the one its copy for the client's own look gets, each claimed before it is made
// and let go if the write fails, so a second press is refused and a failed one may be tried again.

/** A job waiting for its photograph, under the notice the visitor agreed to. */
export async function newUploadJob(
  db: D1Database,
  job: {
    readonly id: string;
    readonly now: Date;
    readonly noticeVersion: string;
    readonly ipHash: string;
    readonly requestId: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tryon_jobs (id, created_at, upload_key, state, photo_consent_version, photo_consent_at, ip_hash,
         request_id)
       VALUES (?1, ?2, ?3, 'awaiting_upload', ?4, ?2, ?5, ?6)`,
    )
    .bind(job.id, job.now.toISOString(), `uploads/${job.id}`, job.noticeVersion, job.ipHash, job.requestId)
    .run();
}

/** The photograph's write claimed: false where it was made, or claimed, before. */
export async function claimUpload(db: D1Database, jobId: string, now: Date): Promise<boolean> {
  const claimed = await db
    .prepare(
      `UPDATE tryon_jobs SET uploaded_at = ?2
       WHERE id = ?1 AND state = 'awaiting_upload' AND uploaded_at IS NULL RETURNING id`,
    )
    .bind(jobId, now.toISOString())
    .first();
  return claimed !== null;
}

/** The photograph's claim let go, its write having failed. */
export async function releaseUpload(db: D1Database, jobId: string): Promise<void> {
  await db.prepare("UPDATE tryon_jobs SET uploaded_at = NULL WHERE id = ?1").bind(jobId).run();
}

/** The copy's write claimed under its key: false where it was made, or claimed, before, or the photograph has gone. */
export async function claimCopy(db: D1Database, jobId: string, key: string): Promise<boolean> {
  const claimed = await db
    .prepare(
      "UPDATE tryon_jobs SET copy_key = ?2 WHERE id = ?1 AND copy_key IS NULL AND upload_deleted_at IS NULL RETURNING id",
    )
    .bind(jobId, key)
    .first();
  return claimed !== null;
}

/** The copy's claim let go, its write having failed. */
export async function releaseCopy(db: D1Database, jobId: string): Promise<void> {
  await db.prepare("UPDATE tryon_jobs SET copy_key = NULL WHERE id = ?1").bind(jobId).run();
}

// Where one of a client's own photographs is kept, for the routes that serve it to the client or to ops.

/** The R2 keys of one of the client's own photographs and its small copy; null for anyone else's. */
export async function ownPhotoKey(
  db: D1Database,
  personId: string,
  photoId: string,
): Promise<{ key: string; contentType: string; thumbnailKey: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT p.r2_key, p.content_type, p.thumbnail_key FROM photos p
       JOIN photo_sets s ON s.id = p.photo_set_id JOIN appointments a ON a.id = s.appointment_id
       WHERE p.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(photoId, personId)
    .first<{ r2_key: string; content_type: string; thumbnail_key: string | null }>();
  if (row === null) return null;
  return { key: row.r2_key, contentType: row.content_type, thumbnailKey: row.thumbnail_key };
}

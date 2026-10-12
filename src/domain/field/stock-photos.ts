// Photographs of stock (docs/decisions/0170-stock-photos.md): a returned piece written off, or what a claim shows its
// supplier. Each is a JPEG or PNG the console made small, kept in the client-photos bucket under stock/ and counted by
// the storage meter, and named by an ID the write that uses it gives back.

import { inspectImage } from "../../lib/image-bytes.ts";
import { putCounted } from "../platform/storage-meter.ts";

/** The most a photograph may weigh: the console sends one of about 250 KB. */
export const MAX_STOCK_PHOTO_BYTES = 2 * 1024 * 1024;

const keyOf = (id: string) => `stock/${id}`;

/** The photograph stored, its ID; null where the bytes are not a JPEG or PNG. */
export async function storeStockPhoto(db: D1Database, bucket: R2Bucket, bytes: Uint8Array): Promise<string | null> {
  const image = inspectImage(bytes);
  if (image === null) return null;
  const id = crypto.randomUUID();
  await putCounted({ db, bucket, key: keyOf(id), bytes, contentType: image.type });
  return id;
}

/** Whether a photograph of this ID was stored. */
export async function stockPhotoExists(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM stored_objects WHERE key = ?1").bind(keyOf(id)).first()) !== null;
}

/** The photograph, or null where there is none of this ID. */
export function stockPhoto(bucket: R2Bucket, id: string): Promise<R2ObjectBody | null> {
  return bucket.get(keyOf(id));
}

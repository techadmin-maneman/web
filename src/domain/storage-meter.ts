// The storage meter (docs/decisions/0093-the-storage-meter.md): what Phase 2's
// two buckets hold, client-photos and referral-cards. That is each visit's
// photographs and their small copies, a try-on's small copy and a client's
// kept look, and the referral cards.
//
// It is one running figure in D1, added to as each object is stored and taken
// from as each is deleted, so reading it never lists a bucket, which R2 bills
// as a Class A operation. Every write to those two buckets goes through here,
// and so does every delete of what was written, except an erasure's sweep of
// keys that may never have been written (src/domain/erasure.ts). When ops are
// told, and what is refused, is src/policy/storage-share.ts.

import {
  hasRoom,
  markReached,
  PHASE_2_SHARE_BYTES,
  RUNAWAY_CEILING_BYTES,
  type Mark,
} from "../policy/storage-share.ts";
import type { AlertOnce } from "./alerts.ts";

/** R2 deletes at most 1,000 keys a call. */
const R2_DELETE_BATCH = 1000;

export interface Meter {
  readonly bytes: number;
  /** The last mark ops were told of: 0 before the first. */
  readonly toldPercent: number;
}

export async function readMeter(db: D1Database): Promise<Meter> {
  const row = await db
    .prepare("SELECT bytes, told_percent FROM storage_meter WHERE id = 1")
    .first<{ bytes: number; told_percent: number }>();
  if (row === null) throw new Error("the storage meter has no row: migration 0055 has not run");
  return { bytes: row.bytes, toldPercent: row.told_percent };
}

async function count(db: D1Database, bytes: number): Promise<void> {
  if (bytes === 0) return;
  await db.prepare("UPDATE storage_meter SET bytes = MAX(0, bytes + ?1) WHERE id = 1").bind(bytes).run();
}

/** Stores an object in one of Phase 2's buckets, and counts it. */
export async function putCounted(
  db: D1Database,
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  await count(db, bytes.byteLength);
}

/**
 * Deletes these objects from one of Phase 2's buckets, and takes what they held off the meter. R2's delete does not
 * say what it freed, so each object is looked at first; a key that holds nothing takes nothing off.
 */
export async function deleteCounted(db: D1Database, bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  const found = await Promise.all([...new Set(keys)].map((key) => bucket.head(key)));
  await deleteObjects(
    db,
    bucket,
    found.filter((object) => object !== null),
  );
}

/** Deletes every object under a prefix, such as one visit's photographs, the ones taken again and their small copies. */
export async function deleteAllUnder(db: D1Database, bucket: R2Bucket, prefix: string): Promise<void> {
  const objects: R2Object[] = [];
  let listed = await bucket.list({ prefix });
  objects.push(...listed.objects);
  while (listed.truncated) {
    listed = await bucket.list({ prefix, cursor: listed.cursor });
    objects.push(...listed.objects);
  }
  await deleteObjects(db, bucket, objects);
}

async function deleteObjects(db: D1Database, bucket: R2Bucket, objects: readonly R2Object[]): Promise<void> {
  for (let start = 0; start < objects.length; start += R2_DELETE_BATCH) {
    const batch = objects.slice(start, start + R2_DELETE_BATCH);
    await bucket.delete(batch.map((object) => object.key));
    await count(db, -batch.reduce((sum, object) => sum + object.size, 0));
  }
}

const gigabytes = (bytes: number) => (bytes / 1e9).toFixed(2);

const OF_THE_SHARE: Readonly<Record<Mark, string>> = { 50: "half of", 80: "80% of", 100: "all of" };

/**
 * Tells ops of the highest mark the figure has passed since they were last told, once. Each mark is told once for
 * good: should the figure fall back and pass it again, it is not told again (the runbook says how to reset it).
 */
export async function tellOfStorage(db: D1Database, alertOnce: AlertOnce): Promise<void> {
  const meter = await readMeter(db);
  const mark = markReached(meter.bytes);
  if (mark === null || mark <= meter.toldPercent) return;
  const claimed = await db
    .prepare("UPDATE storage_meter SET told_percent = ?1 WHERE id = 1 AND told_percent < ?1 RETURNING id")
    .bind(mark)
    .first();
  if (claimed === null) return;
  await alertOnce({
    key: `r2_share:${String(mark)}`,
    message:
      `Phase 2's photographs and referral cards hold ${gigabytes(meter.bytes)} GB in R2, ${OF_THE_SHARE[mark]} their ` +
      `${String(PHASE_2_SHARE_BYTES / 1e9)} GB share (ADR 0039). Uploads go on past it, on R2's paid storage, as the ` +
      "owner ruled (open point 151).",
    link: "/settings",
  });
}

/**
 * Whether `incomingBytes` more may be stored. Refused only past the runaway ceiling, and each refusal is told to ops,
 * then counted (ADR 0067).
 */
export async function roomFor(db: D1Database, alertOnce: AlertOnce, incomingBytes: number): Promise<boolean> {
  const { bytes } = await readMeter(db);
  if (hasRoom(bytes, incomingBytes)) return true;
  await alertOnce({
    key: "r2_runaway_ceiling",
    message:
      `Phase 2's photographs and referral cards hold ${gigabytes(bytes)} GB in R2, past the runaway ceiling of ` +
      `${String(RUNAWAY_CEILING_BYTES / 1e9)} GB, so the technician app's photographs are refused and wait on the ` +
      'phones. Find what is writing them (docs/runbook.md, "R2 storage growing").',
    link: "/settings",
  });
  return false;
}

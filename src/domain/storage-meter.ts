// The storage meter (docs/decisions/0093-the-storage-meter.md): what Phase 2's
// two buckets hold, client-photos and referral-cards. That is each visit's
// photographs and their small copies, a try-on's small copy and a client's
// kept look, and the referral cards.
//
// It is one running figure in D1, beside a row for each object and its size
// (stored_objects, migration 0055). Both are written in one batch as an object
// is stored and as it is deleted, so reading the figure never lists a bucket,
// which R2 bills as a Class A operation, and a delete never reads an object to
// learn its size. An object stored again under its key is counted as it is now,
// and a delete takes off only what a row says, so neither a retry nor two
// deletes of one key at once can count an object twice. Every write to and
// delete from those two buckets goes through here. When ops are told, and what
// is refused, is src/policy/storage-share.ts.

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

/** Stores an object in one of Phase 2's buckets, and counts what it holds now: an object it replaces no longer counts. */
export async function putCounted(
  db: D1Database,
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array | ArrayBuffer,
  contentType: string,
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  await db.batch([
    db
      .prepare(
        `UPDATE storage_meter
         SET bytes = MAX(0, bytes + ?2 - COALESCE((SELECT bytes FROM stored_objects WHERE key = ?1), 0))
         WHERE id = 1`,
      )
      .bind(key, bytes.byteLength),
    db
      .prepare(
        "INSERT INTO stored_objects (key, bytes) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET bytes = excluded.bytes",
      )
      .bind(key, bytes.byteLength),
  ]);
}

/**
 * Deletes these objects from one of Phase 2's buckets, and takes off what their rows say they held: one R2 call for
 * each thousand keys, and one D1 batch. A key with no row, never stored or stored before the meter, takes nothing off.
 */
export async function deleteCounted(db: D1Database, bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  for (let start = 0; start < unique.length; start += R2_DELETE_BATCH) {
    await bucket.delete(unique.slice(start, start + R2_DELETE_BATCH));
  }
  const listed = JSON.stringify(unique);
  const theirs = "SELECT value FROM json_each(?1)";
  await db.batch([
    db
      .prepare(
        `UPDATE storage_meter
         SET bytes = MAX(0, bytes - (SELECT COALESCE(SUM(bytes), 0) FROM stored_objects WHERE key IN (${theirs})))
         WHERE id = 1`,
      )
      .bind(listed),
    db.prepare(`DELETE FROM stored_objects WHERE key IN (${theirs})`).bind(listed),
  ]);
}

/**
 * Deletes everything under these prefixes, such as a client's visits: their photographs, those taken again, and
 * their small copies. R2 is listed for the keys, but the rows are taken off by range, not by what the listing found:
 * an earlier attempt that deleted them from R2 and failed before its D1 batch left rows no listing can find.
 */
export async function deleteUnder(db: D1Database, bucket: R2Bucket, prefixes: readonly string[]): Promise<void> {
  if (prefixes.length === 0) return;
  const keys: string[] = [];
  for (const prefix of prefixes) keys.push(...(await keysUnder(bucket, prefix)));
  for (let start = 0; start < keys.length; start += R2_DELETE_BATCH) {
    await bucket.delete(keys.slice(start, start + R2_DELETE_BATCH));
  }
  const ranges = JSON.stringify(prefixes.map((prefix) => ({ from: prefix, to: pastPrefix(prefix) })));
  // Each range walks the key's own index, from the prefix to the first key past it.
  const underThem = `SELECT o.key, o.bytes FROM json_each(?1) JOIN stored_objects o
    ON o.key >= json_extract(json_each.value, '$.from') AND o.key < json_extract(json_each.value, '$.to')`;
  await db.batch([
    db
      .prepare(
        `UPDATE storage_meter SET bytes = MAX(0, bytes - (SELECT COALESCE(SUM(bytes), 0) FROM (${underThem})))
         WHERE id = 1`,
      )
      .bind(ranges),
    db.prepare(`DELETE FROM stored_objects WHERE key IN (SELECT key FROM (${underThem}))`).bind(ranges),
  ]);
}

/** The first key past every key that begins with the prefix: its last character, one on ("visits/a/" ends "visits/a0"). */
function pastPrefix(prefix: string): string {
  const last = prefix.charCodeAt(prefix.length - 1);
  return `${prefix.slice(0, -1)}${String.fromCharCode(last + 1)}`;
}

/** Every key under a prefix, a page of the listing at a time. */
async function keysUnder(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let listed = await bucket.list({ prefix });
  keys.push(...listed.objects.map((object) => object.key));
  while (listed.truncated) {
    listed = await bucket.list({ prefix, cursor: listed.cursor });
    keys.push(...listed.objects.map((object) => object.key));
  }
  return keys;
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

// The storage meter (docs/decisions/0093-the-storage-meter.md): what the app's
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
// is refused, is src/policy/storage-share.ts: never for a full share, only for uploads at a runaway rate.
//
// Beside it, the database's own size against D1's limit (src/policy/database-size.ts).

import { DATABASE_LIMIT_BYTES, databaseMarkReached } from "../../policy/database-size.ts";
import type { EnvironmentName } from "../../config/environments.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { RateLimitScope } from "../../policy/rate-limits.ts";
import { markReached, SHARE_BYTES, UNUSUAL_DAILY_GROWTH_BYTES } from "../../policy/storage-share.ts";
import { takeOne, type CountedAt } from "../sign-in/rate-limit.ts";
import type { AlertOnce } from "./alerts.ts";

/** R2 deletes at most 1,000 keys a call. */
const R2_DELETE_BATCH = 1000;

interface Meter {
  readonly bytes: number;
  /** The last mark ops were told of: 0 before the first. */
  readonly toldPercent: number;
  /** The India day the day's growth is read from, and the figure as it began; null before the first. */
  readonly growth: { readonly date: string; readonly fromBytes: number } | null;
}

export async function readMeter(db: D1Database): Promise<Meter> {
  const row = await db
    .prepare("SELECT bytes, told_percent, growth_date, growth_from_bytes FROM storage_meter WHERE id = 1")
    .first<{ bytes: number; told_percent: number; growth_date: string | null; growth_from_bytes: number | null }>();
  if (row === null) throw new Error("the storage meter has no row: migration 0055 has not run");
  const growth =
    row.growth_date === null || row.growth_from_bytes === null
      ? null
      : { date: row.growth_date, fromBytes: row.growth_from_bytes };
  return { bytes: row.bytes, toldPercent: row.told_percent, growth };
}

/** Stores an object in one of the two buckets, and counts what it holds now: an object it replaces no longer counts. */
export async function putCounted({
  db,
  bucket,
  key,
  bytes,
  contentType,
}: {
  db: D1Database;
  bucket: R2Bucket;
  key: string;
  bytes: Uint8Array | ArrayBuffer;
  contentType: string;
}): Promise<void> {
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
 * Deletes these objects from one of the two buckets, and takes off what their rows say they held: one R2 call for
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

/** "half of", "80% of", "all of", then "twice", "3 times"… the share. */
function ofTheShare(mark: number): string {
  if (mark < 100) return mark === 50 ? "half of" : `${String(mark)}% of`;
  if (mark === 100) return "all of";
  return mark === 200 ? "twice" : `${String(mark / 100)} times`;
}

/** Settings › Rules, at The console, where the storage and database figures are. */
const STORAGE_LINK = "/settings#console";

/**
 * Tells ops of the highest mark the figure has passed since they were last told, once. Each mark is told once for
 * good: should the figure fall back and pass it again, it is not told again (the runbook says how to reset it).
 */
export async function tellOfStorage(
  db: D1Database,
  alertOnce: AlertOnce,
  environment: EnvironmentName,
  now: Date,
): Promise<void> {
  const meter = await readMeter(db);
  await tellOfUnusualGrowth(db, alertOnce, meter, now);
  const share = SHARE_BYTES[environment];
  const mark = markReached(meter.bytes, share);
  if (mark === null || mark <= meter.toldPercent) return;
  const claimed = await db
    .prepare("UPDATE storage_meter SET told_percent = ?1 WHERE id = 1 AND told_percent < ?1 RETURNING id")
    .bind(mark)
    .first();
  if (claimed === null) return;
  await alertOnce({
    key: `r2_share:${String(mark)}`,
    message:
      `Photos and referral cards use ${gigabytes(meter.bytes)} GB, ${ofTheShare(mark)} their ` +
      `${String(share / 1e9)} GB of free storage. Uploads go on past it, on paid storage.`,
    link: STORAGE_LINK,
  });
}

/** What the database holds now, which D1 gives with the answer to any statement. */
export async function readDatabaseBytes(db: D1Database): Promise<number> {
  const { meta } = await db.prepare("SELECT 1").run();
  return meta.size_after;
}

/**
 * Tells ops of the highest mark the database has passed since they were last told, once, as tellOfStorage does R2's.
 */
export async function tellOfDatabaseSize(db: D1Database, alertOnce: AlertOnce, heldBytes: number): Promise<void> {
  const mark = databaseMarkReached(heldBytes);
  if (mark === null) return;
  const claimed = await db
    .prepare(
      "UPDATE storage_meter SET database_told_percent = ?1 WHERE id = 1 AND database_told_percent < ?1 RETURNING id",
    )
    .bind(mark)
    .first();
  if (claimed === null) return;
  await alertOnce({
    key: `d1_size:${String(mark)}`,
    message:
      `The database holds ${gigabytes(heldBytes)} GB, ${String(mark)}% of the ` +
      `${String(DATABASE_LIMIT_BYTES / 1e9)} GB Cloudflare allows it. Past that every write fails, and ` +
      'bookings, payments and the console stop with them (runbook, "D1 growing").',
    link: STORAGE_LINK,
  });
}

/**
 * At the first look of an India day, how much the figure grew since the day before began, told to ops when more than
 * a day's work could make; the new day is then read from where the figure stands.
 */
async function tellOfUnusualGrowth(db: D1Database, alertOnce: AlertOnce, meter: Meter, now: Date): Promise<void> {
  const today = indiaDate(now);
  if (meter.growth?.date === today) return;
  await db
    .prepare("UPDATE storage_meter SET growth_date = ?1, growth_from_bytes = bytes WHERE id = 1")
    .bind(today)
    .run();
  const grown = meter.growth === null ? 0 : meter.bytes - meter.growth.fromBytes;
  if (grown <= UNUSUAL_DAILY_GROWTH_BYTES) return;
  await alertOnce({
    key: `r2_growth:${today}`,
    message:
      `Photos and referral cards grew by ${gigabytes(grown)} GB since ${meter.growth?.date ?? ""}, more than a day's ` +
      'work makes. Find what is writing them (runbook, "R2 storage growing").',
    link: STORAGE_LINK,
  });
}

/** What an upload of photographs is counted under: a technician's phone, or ops' stock photographs together. */
interface Uploader extends CountedAt {
  readonly scope: Extract<RateLimitScope, `photo_upload:${string}`>;
  readonly key: string;
}

/**
 * Whether the uploader may store one more photograph today. Past their day's limit it is refused, the photographs wait
 * on the phone, and ops are told once (ADR 0067, 0194).
 */
export async function mayUpload(db: D1Database, alertOnce: AlertOnce, uploader: Uploader): Promise<boolean> {
  if (await takeOne(db, uploader.scope, uploader.key, uploader)) return true;
  await alertOnce({
    key: `photo_uploads:${uploader.key}`,
    message:
      `${uploader.scope === "photo_upload:technician" ? "A technician's phone" : "The stock photographs"} reached ` +
      "the day's limit of uploads, more than a day's work makes, so further photographs are refused and wait on the " +
      `phone. Find what is sending them (runbook, "R2 storage growing"; ${uploader.key}).`,
    link: STORAGE_LINK,
  });
  return false;
}

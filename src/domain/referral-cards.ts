// A client's referral card (design/phase2/Referral and Waitlist, A1 and A2; docs/decisions/0048-referrals.md): a
// 1200 x 630 JPEG the API makes from their first fit's front photographs, before and after, with no name and no
// words on it (src/providers/cards.ts). Nothing the client sends becomes a card. It needs their consent to
// photographs on referral cards. Each new card or revoke is a new version, since WhatsApp caches a link's preview by
// its URL: a revoke only reaches new shares.

import { CARD_HEIGHT, CARD_WIDTH } from "../config/referral-cards.ts";
import { inspectImage } from "../lib/image-bytes.ts";
import type { CardComposer } from "../providers/cards.ts";
import { consentGiven } from "./consents.ts";
import { deleteCounted, putCounted } from "./storage-meter.ts";

/** WhatsApp's preview wants an image under 300 KB. */
const MAX_CARD_BYTES = 300 * 1024;

const cardKey = (code: string, version: number) => `cards/${code}/v${String(version)}.jpg`;

/** Whether the client's latest consent to photographs on referral cards is given. */
const cardConsent = (db: D1Database, personId: string): Promise<boolean> =>
  consentGiven(db, personId, "photos_referral_cards");

type Made = { readonly version: number } | { readonly problem: "no_consent" | "not_photographed" | "not_made" };

/** The R2 keys of the front photographs before and after the client's latest completed first fit; null without both. */
async function firstFitFronts(db: D1Database, personId: string): Promise<{ before: string; after: string } | null> {
  const { results } = await db
    .prepare(
      `SELECT s.phase, p.r2_key FROM appointments a
       JOIN photo_sets s ON s.appointment_id = a.id JOIN photos p ON p.photo_set_id = s.id AND p.angle = 'front'
       WHERE a.person_id = ?1 AND a.type = 'first_fit' AND a.status = 'completed' AND a.deleted_at IS NULL
       ORDER BY a.window_start DESC`,
    )
    .bind(personId)
    .all<{ phase: "before" | "after"; r2_key: string }>();
  const before = results.find((row) => row.phase === "before")?.r2_key;
  const after = results.find((row) => row.phase === "after")?.r2_key;
  return before === undefined || after === undefined ? null : { before, after };
}

interface CardStores {
  /** Where the client's photographs are. */
  readonly photos: R2Bucket;
  /** Where their cards are kept. */
  readonly cards: R2Bucket;
}

/** Makes the client's card from their first fit's photographs, and stores it as their code's next version. */
export async function makeCard(
  db: D1Database,
  stores: CardStores,
  composer: CardComposer,
  input: { personId: string; code: string; now: Date },
): Promise<Made> {
  if (!(await cardConsent(db, input.personId))) return { problem: "no_consent" };
  const fronts = await firstFitFronts(db, input.personId);
  if (fronts === null) return { problem: "not_photographed" };
  const [before, after] = await Promise.all([stores.photos.get(fronts.before), stores.photos.get(fronts.after)]);
  if (before === null || after === null) return { problem: "not_photographed" };
  const bytes = await composer.compose({ before: await before.bytes(), after: await after.bytes() });
  const info = inspectImage(bytes);
  if (info?.width !== CARD_WIDTH || info.height !== CARD_HEIGHT || bytes.byteLength > MAX_CARD_BYTES) {
    return { problem: "not_made" };
  }
  return { version: await storeVersion(db, stores.cards, { ...input, bytes }) };
}

/** Stores the card as the code's next version, and deletes the one it replaces. */
async function storeVersion(
  db: D1Database,
  bucket: R2Bucket,
  input: { personId: string; code: string; bytes: Uint8Array; now: Date },
): Promise<number> {
  const row = await db
    .prepare("SELECT card_version, card_key FROM referral_codes WHERE code = ?1 AND person_id = ?2")
    .bind(input.code, input.personId)
    .first<{ card_version: number; card_key: string | null }>();
  if (row === null) throw new Error("the client has no code");
  const version = row.card_version + 1;
  const key = cardKey(input.code, version);
  await putCounted(db, bucket, key, input.bytes, "image/jpeg");
  await db
    .prepare(
      `UPDATE referral_codes SET card_state = 'personal', card_version = ?2, card_key = ?3, updated_at = ?4
       WHERE code = ?1`,
    )
    .bind(input.code, version, key, input.now.toISOString())
    .run();
  if (row.card_key !== null) await deleteCounted(db, bucket, [row.card_key]);
  return version;
}

/** Takes the client's card down: the house card shows on new opens, under a new version. */
export async function revokeCard(db: D1Database, bucket: R2Bucket, personId: string, now: Date): Promise<void> {
  const row = await db
    .prepare("SELECT code, card_key FROM referral_codes WHERE person_id = ?1 AND card_state = 'personal'")
    .bind(personId)
    .first<{ code: string; card_key: string | null }>();
  if (row === null) return;
  await db
    .prepare(
      `UPDATE referral_codes SET card_state = 'house', card_version = card_version + 1, card_key = NULL,
         updated_at = ?2
       WHERE code = ?1`,
    )
    .bind(row.code, now.toISOString())
    .run();
  if (row.card_key !== null) await deleteCounted(db, bucket, [row.card_key]);
}

/** The personal card to show for a code, if it has one still live; otherwise the house card is shown. */
export async function liveCard(db: D1Database, bucket: R2Bucket, code: string): Promise<R2ObjectBody | null> {
  const row = await db
    .prepare(
      `SELECT r.person_id, r.card_key FROM referral_codes r JOIN people p ON p.id = r.person_id
       WHERE r.code = ?1 AND r.card_state = 'personal' AND p.erased_at IS NULL`,
    )
    .bind(code)
    .first<{ person_id: string; card_key: string | null }>();
  const key = row?.card_key ?? null;
  if (row === null || key === null || !(await cardConsent(db, row.person_id))) return null;
  return bucket.get(key);
}

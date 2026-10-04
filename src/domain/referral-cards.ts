// A client's referral card (design/phase2/Referral and Waitlist, A1 and A2; docs/decisions/0048-referrals.md): a
// 1200 x 630 JPEG the app composes on the phone from their first fit's before and after photographs, with no
// name and no words on it. It needs their consent to photographs on referral cards, and a completed first fit with
// photographs of it stored, which is all a card can be made from. Each upload or revoke is a new version, since
// WhatsApp caches a link's preview by its URL: a revoke only reaches new shares.

import { CARD_HEIGHT, CARD_WIDTH } from "../config/referral-cards.ts";
import { inspectImage } from "../lib/image-bytes.ts";
import { consentGiven } from "./consents.ts";
import { deleteCounted, putCounted } from "./storage-meter.ts";

/** WhatsApp's preview wants an image under 300 KB. */
export const MAX_CARD_BYTES = 300 * 1024;

const cardKey = (code: string, version: number) => `cards/${code}/v${String(version)}.jpg`;

/** Whether the client's latest consent to photographs on referral cards is given. */
const cardConsent = (db: D1Database, personId: string): Promise<boolean> =>
  consentGiven(db, personId, "photos_referral_cards");

export type Stored =
  { readonly version: number } | { readonly problem: "no_consent" | "not_photographed" | "not_a_card" };

/** Whether the person's first fit is done and photographed: what their card is made from (ADR 0048). */
async function firstFitPhotographed(db: D1Database, personId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM appointments a
       JOIN photo_sets s ON s.appointment_id = a.id JOIN photos p ON p.photo_set_id = s.id
       WHERE a.person_id = ?1 AND a.type = 'first_fit' AND a.status = 'completed' AND a.deleted_at IS NULL LIMIT 1`,
    )
    .bind(personId)
    .first();
  return row !== null;
}

/** Stores the client's card as their code's next version. */
export async function storeCard(
  db: D1Database,
  bucket: R2Bucket,
  input: { personId: string; code: string; bytes: Uint8Array; now: Date },
): Promise<Stored> {
  if (!(await cardConsent(db, input.personId))) return { problem: "no_consent" };
  if (!(await firstFitPhotographed(db, input.personId))) return { problem: "not_photographed" };
  const info = inspectImage(input.bytes);
  if (
    info?.type !== "image/jpeg" ||
    info.width !== CARD_WIDTH ||
    info.height !== CARD_HEIGHT ||
    input.bytes.byteLength > MAX_CARD_BYTES
  ) {
    return { problem: "not_a_card" };
  }
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
  return { version };
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

// The client's profile: the address a visit goes to, and the five consents
// they switch in the app (docs/decisions/0042-client-profile.md).

import { CURRENT_NOTICE } from "../config/notices.ts";
import { CONSENT_PURPOSES, type ConsentPurpose } from "../policy/consents.ts";

export interface Address {
  readonly line1: string;
  readonly line2: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
  readonly accessNotes: string | null;
}

export async function currentAddress(db: D1Database, personId: string): Promise<Address | null> {
  const row = await db
    .prepare(
      `SELECT line1, line2, locality, city, pincode, access_notes FROM addresses
       WHERE person_id = ?1 AND replaced_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{
      line1: string;
      line2: string | null;
      locality: string;
      city: string;
      pincode: string;
      access_notes: string | null;
    }>();
  if (row === null) return null;
  const { access_notes: accessNotes, ...rest } = row;
  return { ...rest, accessNotes };
}

/** The new address becomes current; the old one is kept, marked replaced. */
export async function saveAddress(db: D1Database, personId: string, address: Address, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE addresses SET replaced_at = ?2 WHERE person_id = ?1 AND replaced_at IS NULL").bind(personId, at),
    db
      .prepare(
        `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, access_notes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        crypto.randomUUID(),
        personId,
        at,
        address.line1,
        address.line2,
        address.locality,
        address.city,
        address.pincode,
        address.accessNotes,
      ),
  ]);
}

export interface ConsentState {
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  /** When it was last switched; null if the client has never switched it. */
  readonly since: string | null;
}

export interface ConsentRecord extends ConsentState {
  /** The notice the client saw when they last switched it; null if they never have. */
  readonly noticeVersion: string | null;
}

/**
 * "Each purpose carries its own date": the latest switch of each, or off if
 * never switched, with the notice version that switch was given under. Ops read
 * the notice version as the consent record (docs/decisions/0049-dpdp.md); the
 * client app shows the state and the date alone.
 */
export async function consentRecordsOf(db: D1Database, personId: string): Promise<ConsentRecord[]> {
  const placeholders = CONSENT_PURPOSES.map((_, index) => `?${String(index + 2)}`).join(", ");
  const rows = await db
    .prepare(
      `SELECT purpose, granted, notice_version, created_at FROM consents
       WHERE person_id = ?1 AND purpose IN (${placeholders}) ORDER BY created_at, rowid`,
    )
    .bind(personId, ...CONSENT_PURPOSES)
    .all<{ purpose: ConsentPurpose; granted: number; notice_version: string; created_at: string }>();
  const latest = new Map(rows.results.map((row) => [row.purpose, row]));
  return CONSENT_PURPOSES.map((purpose) => {
    const row = latest.get(purpose);
    return {
      purpose,
      granted: row?.granted === 1,
      since: row?.created_at ?? null,
      noticeVersion: row?.notice_version ?? null,
    };
  });
}

export async function consentsOf(db: D1Database, personId: string): Promise<ConsentState[]> {
  const records = await consentRecordsOf(db, personId);
  return records.map(({ purpose, granted, since }) => ({ purpose, granted, since }));
}

/** A switch is a new row: the consent record is append-only. */
export function switchConsent(
  db: D1Database,
  options: { personId: string; purpose: ConsentPurpose; granted: boolean; ipHash: string; now: Date },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      options.personId,
      options.purpose,
      CURRENT_NOTICE[options.purpose],
      options.granted ? 1 : 0,
      options.now.toISOString(),
      options.ipHash,
    );
}

/** "+91 98xxx x4417", as the design shows a number. */
export function maskedMobile(mobileE164: string): string {
  const digits = mobileE164.replace(/^\+91/, "");
  return `+91 ${digits.slice(0, 2)}xxx x${digits.slice(-4)}`;
}

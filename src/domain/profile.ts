// The client's profile: the address a visit goes to, and the five consents
// they switch in the app (docs/decisions/0042-client-profile.md).

import { CURRENT_NOTICE } from "../config/notices.ts";
import { CONSENT_PURPOSES, type AppSwitchSource, type ConsentPurpose, type ConsentSource } from "../policy/consents.ts";

/** Where a coordinate came from; the licence and the trust differ by source (ADR 0054). */
export type GeocodeSource = "google_geocoding" | "device" | "checkin";

/** The pin, and the record of where it came from that migration 0028 keeps beside it. */
export interface AddressPin {
  readonly lat: number;
  readonly lng: number;
  readonly source: GeocodeSource;
}

export interface Address {
  readonly line1: string;
  readonly line2: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
  readonly accessNotes: string | null;
  /** The building as chosen from the suggestions; null when the address was typed. */
  readonly building: string | null;
  readonly flat: string | null;
  readonly floor: string | null;
  readonly tower: string | null;
  readonly landmark: string | null;
  /** Google's Place ID for the building, which we may keep for good. */
  readonly placeId: string | null;
}

const ADDRESS_COLUMNS = `line1, line2, locality, city, pincode, access_notes,
       building, flat, floor, tower, landmark, place_id`;

interface AddressRow {
  line1: string;
  line2: string | null;
  locality: string;
  city: string;
  pincode: string;
  access_notes: string | null;
  building: string | null;
  flat: string | null;
  floor: string | null;
  tower: string | null;
  landmark: string | null;
  place_id: string | null;
}

/** An address's street as FSM's service address holds it: the first line, then the rest of it. */
export function streetOf(address: { line1: string; line2: string | null; locality: string | null }): {
  street1: string;
  street2: string | null;
} {
  const rest = [address.line2, address.locality].filter((part) => part !== null && part !== "").join(", ");
  return { street1: address.line1, street2: rest === "" ? null : rest };
}

/** An address saved before migration 0028 has nulls in the new columns and reads unchanged. */
const fromRow = ({ access_notes: accessNotes, place_id: placeId, ...rest }: AddressRow): Address => ({
  ...rest,
  accessNotes,
  placeId,
});

/** A person's name and the number they hold now; null once they are erased. */
export async function liveContact(
  db: D1Database,
  personId: string,
): Promise<{ readonly name: string; readonly mobileE164: string } | null> {
  const person = await db
    .prepare("SELECT name, mobile_e164 FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(personId)
    .first<{ name: string; mobile_e164: string }>();
  return person === null ? null : { name: person.name, mobileE164: person.mobile_e164 };
}

export async function currentAddress(db: D1Database, personId: string): Promise<Address | null> {
  const row = await db
    .prepare(
      `SELECT ${ADDRESS_COLUMNS} FROM addresses
       WHERE person_id = ?1 AND replaced_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<AddressRow>();
  return row === null ? null : fromRow(row);
}

const INSERT_ADDRESS = `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode,
                                access_notes, building, flat, floor, tower, landmark, place_id, lat, lng, geocoded_at,
                                geocode_source)`;

/** The values INSERT_ADDRESS takes, as ?1 to ?19. */
const ADDRESS_VALUES = "?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19";

function addressValues(personId: string, address: Address, pin: AddressPin | null, at: string): unknown[] {
  return [
    crypto.randomUUID(),
    personId,
    at,
    address.line1,
    address.line2,
    address.locality,
    address.city,
    address.pincode,
    address.accessNotes,
    address.building,
    address.flat,
    address.floor,
    address.tower,
    address.landmark,
    address.placeId,
    pin?.lat ?? null,
    pin?.lng ?? null,
    pin === null ? null : at,
    pin?.source ?? null,
  ];
}

/**
 * The new address becomes current; the old one is kept, marked replaced.
 *
 * The pin is written here rather than by a later mirror, so that the coordinate
 * and the address it belongs to are never out of step. It is the client's own
 * address row and no one else's: Google's Geocoding terms allow an indefinite
 * cache only where it is "logically isolated to the specific End User", so a
 * building's coordinate is never reused across clients (ADR 0054).
 */
export async function saveAddress(
  db: D1Database,
  personId: string,
  address: Address,
  pin: AddressPin | null,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db.prepare("UPDATE addresses SET replaced_at = ?2 WHERE person_id = ?1 AND replaced_at IS NULL").bind(personId, at),
    db.prepare(`${INSERT_ADDRESS} VALUES (${ADDRESS_VALUES})`).bind(...addressValues(personId, address, pin, at)),
  ]);
}

/**
 * A person's first address, with no pin, for a batch it must stand or fall with: a booking from the site writes
 * it with the slot. It is written only while the person has no address, and never replaces one: the write
 * settles it, so two bookings at once cannot both write one (src/policy/site-booking.ts).
 */
export function firstAddressStatement(
  db: D1Database,
  personId: string,
  address: Address,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare(
      `${INSERT_ADDRESS}
       SELECT ${ADDRESS_VALUES}
       WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE person_id = ?2 AND replaced_at IS NULL)`,
    )
    .bind(...addressValues(personId, address, null, now.toISOString()));
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
  /**
   * Where they last switched it; null if they never have, or it was not recorded
   * (docs/decisions/0094-where-a-consent-was-given.md).
   */
  readonly source: ConsentSource | null;
}

/**
 * "Each purpose carries its own date": the latest switch of each, or off if
 * never switched, with the notice version that switch was given under and where.
 * Ops read them as the consent record (docs/decisions/0049-dpdp.md); the client
 * app shows the state and the date alone.
 */
export async function consentRecordsOf(db: D1Database, personId: string): Promise<ConsentRecord[]> {
  const placeholders = CONSENT_PURPOSES.map((_, index) => `?${String(index + 2)}`).join(", ");
  const rows = await db
    .prepare(
      `SELECT purpose, granted, notice_version, created_at, source FROM consents
       WHERE person_id = ?1 AND purpose IN (${placeholders}) ORDER BY created_at, rowid`,
    )
    .bind(personId, ...CONSENT_PURPOSES)
    .all<{
      purpose: ConsentPurpose;
      granted: number;
      notice_version: string;
      created_at: string;
      source: ConsentSource | null;
    }>();
  const latest = new Map(rows.results.map((row) => [row.purpose, row]));
  return CONSENT_PURPOSES.map((purpose) => {
    const row = latest.get(purpose);
    return {
      purpose,
      granted: row?.granted === 1,
      since: row?.created_at ?? null,
      noticeVersion: row?.notice_version ?? null,
      source: row?.source ?? null,
    };
  });
}

export async function consentsOf(db: D1Database, personId: string): Promise<ConsentState[]> {
  const records = await consentRecordsOf(db, personId);
  return records.map(({ purpose, granted, since }) => ({ purpose, granted, since }));
}

/**
 * A switch is a new row: the consent record is append-only. The same answer again, under the same
 * notice, is not a new answer and writes nothing; a notice that has changed since makes it one,
 * because what the client agreed to has changed.
 *
 * The write settles it, rather than a read before it, so two taps on one Allow cannot both find
 * the purpose unswitched and both record it. The ledger is append-only by trigger, so a second
 * row could never be taken back afterwards (ADR 0058).
 *
 * The statement returns the row's date when it wrote one, and nothing when it did not. The row keeps which of the
 * app's screens made the switch, or none where the app did not say (docs/decisions/0094-where-a-consent-was-given.md).
 */
export function switchConsent(
  db: D1Database,
  options: {
    personId: string;
    purpose: ConsentPurpose;
    granted: boolean;
    source: AppSwitchSource | null;
    ipHash: string;
    now: Date;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
       WHERE NOT EXISTS (
         SELECT 1 FROM (SELECT granted, notice_version FROM consents WHERE person_id = ?2 AND purpose = ?3
                        ORDER BY created_at DESC, rowid DESC LIMIT 1)
         WHERE granted = ?5 AND notice_version = ?4
       )
       RETURNING created_at`,
    )
    .bind(
      crypto.randomUUID(),
      options.personId,
      options.purpose,
      CURRENT_NOTICE[options.purpose],
      options.granted ? 1 : 0,
      options.now.toISOString(),
      options.ipHash,
      options.source,
    );
}

/**
 * A consent given, on the notice the client was shown, only while they have never decided on the purpose: a
 * purpose they have switched, either way, is left as they left it (ADR 0080). As with switchConsent, the write
 * settles it, so two taps at once record it once. Returns the row's ID, for an audit entry written only with it.
 */
export function grantIfUndecided(
  db: D1Database,
  options: {
    personId: string;
    purpose: ConsentPurpose;
    noticeVersion: string;
    source: ConsentSource;
    ipHash: string;
    now: Date;
  },
): { readonly id: string; readonly statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
       SELECT ?1, ?2, ?3, ?4, 1, ?5, ?6, ?7
       WHERE NOT EXISTS (SELECT 1 FROM consents WHERE person_id = ?2 AND purpose = ?3)`,
    )
    .bind(
      id,
      options.personId,
      options.purpose,
      options.noticeVersion,
      options.now.toISOString(),
      options.ipHash,
      options.source,
    );
  return { id, statement };
}

/** "+91 98xxx x4417", as the design shows a number. */
export function maskedMobile(mobileE164: string): string {
  const digits = mobileE164.replace(/^\+91/, "");
  return `+91 ${digits.slice(0, 2)}xxx x${digits.slice(-4)}`;
}

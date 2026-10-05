// The client's profile: the address a visit goes to, and where the five consents
// they switch in the app stand. Consents are written in src/domain/consents.ts.

import { auditStatement, type AuditEntry } from "./audit.ts";
import { CONSENT_PURPOSES, type ConsentPurpose, type ConsentSource } from "../policy/consents.ts";
import { STREET_MAX, zohoText } from "../lib/zoho-text.ts";

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

/** An address as it is kept: who it was given to, where a client gave it to ops on the phone. */
export interface SavedAddress extends Address {
  /** The member of staff's Access e-mail, and when; null for an address the client saved themselves. */
  readonly givenToOps: { readonly staff: string; readonly at: string } | null;
}

/**
 * An address a client gave ops on the phone, which a member of staff saves for them (docs/decisions/0092-task-owners.md),
 * with its audit entry.
 */
export interface GivenToOps {
  readonly staff: string;
  readonly audit: AuditEntry;
}

const ADDRESS_COLUMNS = `line1, line2, locality, city, pincode, access_notes,
       building, flat, floor, tower, landmark, place_id, given_to_staff, created_at`;

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
  given_to_staff: string | null;
  created_at: string;
}

/** The parts of an address's street; one saved before migration 0028 has no flat, floor or tower. */
interface StreetParts {
  readonly flat: string | null;
  readonly floor: string | null;
  readonly tower: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly locality: string | null;
}

/** A part with its name before it, unless the client wrote the name: "Floor 3", "3rd floor", never "Floor 3rd floor". */
function named(name: string, written: RegExp, part: string | null): string | null {
  const words = part?.trim() ?? "";
  if (words === "") return null;
  return written.test(words) ? words : `${name} ${words}`;
}

const joined = (parts: readonly (string | null)[]): string =>
  parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(", ");

/**
 * An address's street in two lines, as the client's Books customer holds it: the flat, floor, tower and building,
 * then the street, the area and the landmark, each line cut to what Zoho takes.
 */
export function streetOf(address: StreetParts): { street1: string; street2: string | null } {
  const door = joined([
    address.flat,
    named("Floor", /\bfloor\b/i, address.floor),
    named("Tower", /\b(tower|block|wing)\b/i, address.tower),
    address.line1,
  ]);
  const rest = joined([address.line2, address.locality, named("Landmark:", /\blandmark\b/i, address.landmark)]);
  return { street1: zohoText(door, STREET_MAX), street2: rest === "" ? null : zohoText(rest, STREET_MAX) };
}

/** An address saved before migration 0028 has nulls in the new columns and reads unchanged. */
function fromRow(row: AddressRow): SavedAddress {
  const { access_notes: accessNotes, place_id: placeId, given_to_staff: givenTo, created_at: savedAt, ...rest } = row;
  return {
    ...rest,
    accessNotes,
    placeId,
    givenToOps: givenTo === null ? null : { staff: givenTo, at: savedAt },
  };
}

/** A person's name and the number they hold now; null once they are erased. */
export async function liveContact(
  db: D1Database,
  personId: string,
): Promise<{ readonly name: string; readonly mobileE164: string; readonly testRecord: boolean } | null> {
  const person = await db
    .prepare("SELECT name, mobile_e164, test_record FROM people WHERE id = ?1 AND erased_at IS NULL")
    .bind(personId)
    .first<{ name: string; mobile_e164: string; test_record: number }>();
  return person === null
    ? null
    : { name: person.name, mobileE164: person.mobile_e164, testRecord: person.test_record === 1 };
}

export async function currentAddress(db: D1Database, personId: string): Promise<SavedAddress | null> {
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
                                geocode_source, given_to_staff)`;

/** The values INSERT_ADDRESS takes, as ?1 to ?20. */
const ADDRESS_VALUES = "?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20";

function addressValues(
  personId: string,
  address: Address,
  pin: AddressPin | null,
  at: string,
  givenTo: string | null,
): unknown[] {
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
    givenTo,
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
 *
 * One a client gave ops on the phone is marked with the member of staff who saved it, and audited in the same batch.
 */
export async function saveAddress(
  db: D1Database,
  saving: {
    readonly personId: string;
    readonly address: Address;
    readonly pin: AddressPin | null;
    readonly now: Date;
    readonly givenToOps: GivenToOps | null;
  },
): Promise<void> {
  const { personId, address, pin, now, givenToOps } = saving;
  const at = now.toISOString();
  const values = addressValues(personId, address, pin, at, givenToOps?.staff ?? null);
  await db.batch([
    db.prepare("UPDATE addresses SET replaced_at = ?2 WHERE person_id = ?1 AND replaced_at IS NULL").bind(personId, at),
    db.prepare(`${INSERT_ADDRESS} VALUES (${ADDRESS_VALUES})`).bind(...values),
    ...(givenToOps === null ? [] : [auditStatement(db, givenToOps.audit, now)]),
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
    .bind(...addressValues(personId, address, null, now.toISOString(), null));
}

export interface ConsentState {
  readonly purpose: ConsentPurpose;
  readonly granted: boolean;
  /** When it was last switched; null if the client has never switched it. */
  readonly since: string | null;
}

interface ConsentRecord extends ConsentState {
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

/** "+91 98xxx x4417", as the design shows a number. */
export function maskedMobile(mobileE164: string): string {
  const digits = mobileE164.replace(/^\+91/, "");
  return `+91 ${digits.slice(0, 2)}xxx x${digits.slice(-4)}`;
}

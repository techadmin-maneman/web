// What Meta and Google are given to match a conversion to an ad click, as each asks for it
// (docs/decisions/0288-attribution-and-conversions.md): a phone number, a name and the place of the client's address
// hashed with SHA-256, never in the clear but for the pincode Google takes as it is, and Meta's click cookie built from
// its click ID where the browser had none.
//
// Each normalises a number its own way before hashing: Meta wants the digits with the country code and no plus
// ("919810000000"), Google the E.164 form with it ("+919810000000").

import { sha256Hex } from "./hash.ts";
import { firstNameOf, lastNameOf } from "./names.ts";

/** A stored number for Meta: "+919810000000" hashed as "919810000000". */
export const metaPhoneHash = (mobileE164: string): Promise<string> => sha256Hex(mobileE164.replace(/\D/g, ""));

/** A stored number for Google: hashed as it is stored, "+919810000000". */
export const googlePhoneHash = (mobileE164: string): Promise<string> => sha256Hex(`+${mobileE164.replace(/\D/g, "")}`);

/**
 * A person's first name for Meta: small letters only, no spaces or punctuation, in whatever script it is written;
 * null where nothing is left to hash.
 */
export const metaFirstNameHash = (name: string): Promise<string | null> => lettersHash(firstNameOf(name));

/** Words as Meta and Google hash a name or a place: small letters only, no spaces or punctuation; null for none. */
async function lettersHash(words: string): Promise<string | null> {
  const letters = words
    .normalize("NFC")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{M}]/gu, "");
  return letters === "" ? null : sha256Hex(letters);
}

/** Where the client's current address is: its city, the city's state and its pincode, each null where unknown. */
export interface Place {
  readonly city: string | null;
  readonly state: string | null;
  readonly pincode: string | null;
}

/** Meta's place fields, hashed: city, state and pincode where known, and the country, India, always. */
export interface MetaPlace {
  readonly ct: string | null;
  readonly st: string | null;
  readonly zp: string | null;
  readonly country: string;
}

const PINCODE = /^\d{6}$/;

export async function metaPlaceHash(place: Place): Promise<MetaPlace> {
  const [ct, st, zp, country] = await Promise.all([
    place.city === null ? null : lettersHash(place.city),
    place.state === null ? null : lettersHash(place.state),
    place.pincode !== null && PINCODE.test(place.pincode) ? sha256Hex(place.pincode) : null,
    sha256Hex("in"),
  ]);
  return { ct, st, zp, country };
}

/** Google's address identifier: both names hashed, the region and the pincode as they are. */
export interface GoogleAddress {
  readonly givenName: string;
  readonly familyName: string;
  readonly regionCode: "IN";
  readonly postalCode: string;
}

/** Google's address identifier, which it matches only whole: null without a first and a last name and a pincode. */
export async function googleAddressOf(name: string, place: Place): Promise<GoogleAddress | null> {
  if (place.pincode === null || !PINCODE.test(place.pincode)) return null;
  const [givenName, familyName] = await Promise.all([lettersHash(firstNameOf(name)), lettersHash(lastNameOf(name))]);
  if (givenName === null || familyName === null) return null;
  return { givenName, familyName, regionCode: "IN", postalCode: place.pincode };
}

/** Meta's click cookie, `fb.1.<ms>.<fbclid>`: the 1 is the domain's level, maneman.in. */
export const FBC_PATTERN = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;

/** Meta's browser cookie, `fb.1.<ms>.<random>`, as the Pixel sets it. */
export const FBP_PATTERN = /^fb\.\d\.\d{10,13}\.\d{5,20}$/;

/** The click cookie Meta would have set, from its click ID and when the visitor landed. */
export const fbcOf = (fbclid: string, landedAt: Date): string => `fb.1.${String(landedAt.getTime())}.${fbclid}`;

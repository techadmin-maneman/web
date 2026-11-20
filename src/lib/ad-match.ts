// What Meta and Google are given to match a conversion to an ad click, as each asks for it
// (docs/decisions/0288-attribution-and-conversions.md): a phone number and a first name hashed with SHA-256, never in
// the clear, and Meta's click cookie built from its click ID where the browser had none.
//
// Each normalises a number its own way before hashing: Meta wants the digits with the country code and no plus
// ("919810000000"), Google the E.164 form with it ("+919810000000").

import { sha256Hex } from "./hash.ts";
import { firstNameOf } from "./names.ts";

/** A stored number for Meta: "+919810000000" hashed as "919810000000". */
export const metaPhoneHash = (mobileE164: string): Promise<string> => sha256Hex(mobileE164.replace(/\D/g, ""));

/** A stored number for Google: hashed as it is stored, "+919810000000". */
export const googlePhoneHash = (mobileE164: string): Promise<string> => sha256Hex(`+${mobileE164.replace(/\D/g, "")}`);

/**
 * A person's first name for Meta: small letters only, no spaces or punctuation, in whatever script it is written;
 * null where nothing is left to hash.
 */
export async function metaFirstNameHash(name: string): Promise<string | null> {
  const letters = firstNameOf(name)
    .normalize("NFC")
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{M}]/gu, "");
  return letters === "" ? null : sha256Hex(letters);
}

/** Meta's click cookie, `fb.1.<ms>.<fbclid>`: the 1 is the domain's level, maneman.in. */
export const FBC_PATTERN = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;

/** Meta's browser cookie, `fb.1.<ms>.<random>`, as the Pixel sets it. */
export const FBP_PATTERN = /^fb\.\d\.\d{10,13}\.\d{5,20}$/;

/** The click cookie Meta would have set, from its click ID and when the visitor landed. */
export const fbcOf = (fbclid: string, landedAt: Date): string => `fb.1.${String(landedAt.getTime())}.${fbclid}`;

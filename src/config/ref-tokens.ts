// The short reference a site visitor's WhatsApp message carries, "Ref M7K2Q", which ties the chat to where the visit
// came from (docs/decisions/0288-attribution-and-conversions.md). The API gives each visitor one; the site puts it at the
// end of the words the chat opens with, and the WhatsApp webhook reads it back. Its letters are those no one misreads.

export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const REF_LENGTH = 5;

/** A reference on its own, as the API gives it. */
export const REF_PATTERN = new RegExp(`^[${REF_ALPHABET}]{${String(REF_LENGTH)}}$`);

/** The line the message ends with. */
export const refLine = (ref: string): string => `Ref ${ref}`;

/** The reference a message carries, in capitals, or null; a client who retypes it in small letters is still read. */
export function refIn(text: string): string | null {
  const found = new RegExp(`\\bref\\s*[:#-]?\\s*([${REF_ALPHABET}]{${String(REF_LENGTH)}})\\b`, "i").exec(
    text.toUpperCase(),
  );
  return found?.[1] ?? null;
}

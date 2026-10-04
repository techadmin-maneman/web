// Text a Zoho address line keeps whole. Zoho answers success and silently drops everything from the first character
// past U+FFFF, so those are left out first.

/** The most an address line takes: Zoho refuses 256 characters. */
export const STREET_MAX = 255;

/** Characters past U+FFFF, such as 🙏 or 🇮🇳. Zoho keeps ✅ and ❤️, which come before it. */
const PAST_U_FFFF = /[\u{10000}-\u{10FFFF}]/gu;

/** Text Zoho will keep whole, in at most `max` characters. Text still too long ends in "…". */
export function zohoText(text: string, max: number): string {
  const kept = text.replace(PAST_U_FFFF, "").replace(/ {2,}/g, " ").trim();
  return kept.length <= max ? kept : `${kept.slice(0, max - 1).trimEnd()}…`;
}

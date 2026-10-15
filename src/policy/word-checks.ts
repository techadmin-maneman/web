// What a changed line must keep before the Words page saves it (docs/decisions/0126-the-words-page.md): the holes the
// page or the message fills, no price or reward typed by hand, no placeholder text, a length the layout holds, and for
// a WhatsApp message a first line that says nothing of the visit, since a phone shows it on its lock screen. The
// production build's own gate holds the site to the same (site/src/lib/publish-gate.ts).

/** Why a line is refused, as the page names the box. */
export type WordRefusal =
  "empty" | "holes" | "price" | "visits" | "placeholder" | "length" | "first_line" | "ends_on_detail";

/** "{city}" on the site, "{{2}}" in a message: what the page or the sender fills. */
const HOLE = /\{\{\d+\}\}|\{[a-zA-Z]+\}/g;

/** "Rs." or a rupee sign before a digit: a price written into a sentence, where the price book fills a hole. */
const TYPED_PRICE = /(?:Rs\.|\u20B9)\s?\d/;

/** A count of visits a referral earns, in figures or in words, which what ops set builds. */
const TYPED_VISITS =
  /\b\d+ (?:service )?visits?\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?:service )?visits? (?:free|lands?|do(?:es)? not apply)\b/i;

const PLACEHOLDER = /\bplaceholder\b|\blorem\b|\bTODO\b|\bTBD\b/i;

/** Text marked to be written later, which no one should read. */
export const isPlaceholder = (text: string): boolean => PLACEHOLDER.test(text);

/** What a message's first line may not name: the lock screen shows it to anyone near the phone. */
const SAYS_THE_VISIT = /hair|fit/i;

const holesOf = (text: string): string[] => [...text.matchAll(HOLE)].map((match) => match[0]).sort();

const sameHoles = (one: string, other: string): boolean => holesOf(one).join(" ") === holesOf(other).join(" ");

/** The longest a line may grow: half again as long as the code's wording, and never less than 20 more. */
export const longestOf = (wording: string): number => Math.max(Math.ceil(wording.length * 1.5), wording.length + 20);

/** Why a message's text is refused, beyond what every line keeps; null when it may be sent. */
function messageRefusal(text: string, wording: string): WordRefusal | null {
  const first = text.split("\n")[0] ?? "";
  const wordingFirst = wording.split("\n")[0] ?? "";
  if (SAYS_THE_VISIT.test(first) || !sameHoles(first, wordingFirst)) return "first_line";
  const endsOnHole = /\{\{\d+\}\}\s*$/;
  if (endsOnHole.test(text) && !endsOnHole.test(wording)) return "ends_on_detail";
  return null;
}

/**
 * Why `text` may not replace the code's `wording` for a line, or null when it may. What the code's own wording does,
 * such as the comparison's prices elsewhere, a changed line may do too.
 */
export function wordRefusal(text: string, wording: string, surface: "site" | "message"): WordRefusal | null {
  if (text.trim() === "") return "empty";
  if (!sameHoles(text, wording)) return "holes";
  if (TYPED_PRICE.test(text) && !TYPED_PRICE.test(wording)) return "price";
  if (TYPED_VISITS.test(text) && !TYPED_VISITS.test(wording)) return "visits";
  if (PLACEHOLDER.test(text) && !PLACEHOLDER.test(wording)) return "placeholder";
  if (text.length > longestOf(wording)) return "length";
  return surface === "message" ? messageRefusal(text, wording) : null;
}

// A code made from words ops type: a consumable's, a job-sheet item's, a service tier's. Small letters and digits with
// _ between words, accents dropped, so "Crème adhesive" is creme_adhesive wherever it is typed.

/** The words as a code, at most `length` long; empty where the words give none, as words in another script would. */
export function slugOf(words: string, length: number): string {
  return words
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, length)
    .replace(/_+$/, "");
}

/** A new code from words, or `fallback` where they give none, numbered past those taken: tape_strips, tape_strips_2. */
export function freshCode(words: string, length: number, fallback: string, taken: ReadonlySet<string>): string {
  const base = slugOf(words, length) || fallback;
  let code = base;
  for (let next = 2; taken.has(code); next += 1) code = `${base}_${String(next)}`;
  return code;
}

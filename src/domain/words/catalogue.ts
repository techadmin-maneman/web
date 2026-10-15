// The lines the Words page may change (docs/decisions/0126-the-words-page.md), as src/config/words.json lists them:
// each with its key, where it appears and its wording in the code. `npm run words` (and `npm run gen`) writes the file from the copy.

import WORDS from "../../config/words.json" with { type: "json" };

export interface WordLine {
  readonly key: string;
  readonly surface: "site" | "message";
  readonly group: string;
  readonly where: string;
  readonly text: string;
  /** Whether a copy review has read the line in its wording in the code. */
  readonly reviewed: boolean;
}

export const WORD_LINES: readonly WordLine[] = WORDS as readonly WordLine[];

const BY_KEY: ReadonlyMap<string, WordLine> = new Map(WORD_LINES.map((line) => [line.key, line]));

/** A line by its key; undefined for a key the list does not hold. */
export const wordLine = (key: string): WordLine | undefined => BY_KEY.get(key);

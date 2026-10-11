// The lines the Words page may change (docs/decisions/0126-the-words-page.md), as src/config/words.json lists them:
// each with its key, where it appears and its wording in the code. `npm run words` writes the file from the copy.

import WORDS from "../../config/words.json" with { type: "json" };

export interface WordLine {
  readonly key: string;
  readonly surface: "site" | "message";
  readonly group: string;
  readonly where: string;
  readonly text: string;
}

export const WORD_LINES: readonly WordLine[] = WORDS as readonly WordLine[];

const BY_KEY: ReadonlyMap<string, WordLine> = new Map(WORD_LINES.map((line) => [line.key, line]));

/** A line by its key; undefined for a key the list does not hold. */
export const wordLine = (key: string): WordLine | undefined => BY_KEY.get(key);

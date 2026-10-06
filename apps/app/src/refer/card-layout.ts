// The referral card as the design draws it (design/phase2/Referral and Waitlist,
// "A1 · Personal"): 1200 × 630, the before on the left and the after on the
// right at the same crop, one gilt rule 2 px wide down the middle, and the mark
// with the wordmark's small cut in the bottom right corner. No name and no
// words. The house card's script (scripts/build/make-house-card.ts) draws from
// these figures, and so the overlay the API lays over a client's photographs.

import { CARD_HEIGHT, CARD_WIDTH, HALF_WIDTH, RULE_WIDTH } from "../../../../src/config/referral-cards.ts";

export { CARD_HEIGHT, CARD_WIDTH, HALF_WIDTH, RULE_WIDTH };

/** The lockup, 40 px in from the right and 34 up from the foot: the mark, 18 px, then the wordmark. */
export const LOCKUP = {
  right: 40,
  bottom: 34,
  gap: 18,
  mark: { width: 44, height: 48 },
  wordmark: { width: 140, height: 23 },
} as const;

export interface Place {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Where the mark and the wordmark stand on the card, each centred on the lockup's line. */
export function lockupPlaces(): { mark: Place; wordmark: Place } {
  const width = LOCKUP.mark.width + LOCKUP.gap + LOCKUP.wordmark.width;
  const height = Math.max(LOCKUP.mark.height, LOCKUP.wordmark.height);
  const left = CARD_WIDTH - LOCKUP.right - width;
  const top = CARD_HEIGHT - LOCKUP.bottom - height;
  return {
    mark: { ...LOCKUP.mark, left, top: top + (height - LOCKUP.mark.height) / 2 },
    wordmark: {
      ...LOCKUP.wordmark,
      left: left + LOCKUP.mark.width + LOCKUP.gap,
      top: top + (height - LOCKUP.wordmark.height) / 2,
    },
  };
}

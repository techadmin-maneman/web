// The referral card as board A1 draws it (design/phase2/Referral and Waitlist,
// "A1 · Personal"): 1200 × 630, the before on the left and the after on the
// right at the same crop, one gilt rule 2 px wide down the middle, and the mark
// with the wordmark's small cut in the bottom right corner. No name and no
// words. The phone's composition (card-draw.ts) and the house card's script
// (scripts/make-house-card.ts) both draw from these figures.

import { CARD_HEIGHT, CARD_WIDTH } from "../../../../src/config/referral-cards.ts";

export { CARD_HEIGHT, CARD_WIDTH };
export const RULE_WIDTH = 2;

/** Each photograph's half: the width either side of the rule. */
export const HALF_WIDTH = (CARD_WIDTH - RULE_WIDTH) / 2;

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

export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** "-3 -3 638 106" → its four numbers. */
export function viewBoxOf(viewBox: string): ViewBox {
  const [x = 0, y = 0, width = 1, height = 1] = viewBox.split(" ").map(Number);
  return { x, y, width, height };
}

/** The brand's colours the card is drawn in, read from packages/brand/tokens.css by whoever draws it. */
export interface CardColours {
  readonly ink: string;
  readonly gilt: string;
  readonly paper: string;
}

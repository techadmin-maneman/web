// A client's referral card (docs/decisions/0048-referrals.md): the size the API makes it at
// (src/providers/cards.ts) and the invite's page shows it at, and board A1's rule between its two halves.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const RULE_WIDTH = 2;

/** Each photograph's half: the width either side of the rule. */
export const HALF_WIDTH = (CARD_WIDTH - RULE_WIDTH) / 2;

// The card as boards F2 and F4 draw it inside the app, at 1200:630: the house example as the file itself, and the
// client's own as it will be composed, their two front photographs either side of the gilt rule with the lockup
// in the corner. Before the photographs arrive, or where there are none, the halves are the ink blocks the boards
// draw.

import { WORDMARK_SMALL } from "@maneman/brand/marks";
import { Mark } from "@maneman/ui/Mark";
import type { FirstFitPair } from "./card.ts";
import houseCard from "./invite-house.jpg";
import styles from "./refer.module.css";

/** The house example as the app bundles it, the same file as the site's (scripts/make-house-card.ts). */
export { houseCard };

/** What a card preview shows: the house example, the client's own before it is made, or a card already made. */
export type Shown =
  | { readonly kind: "house" }
  | { readonly kind: "mine"; readonly pair: FirstFitPair | null }
  | { readonly kind: "made"; readonly url: string };

export function CardPreview({ shown }: { shown: Shown }) {
  if (shown.kind === "house") return <img className={styles.card} src={houseCard} alt="" width={1200} height={630} />;
  if (shown.kind === "made") return <img className={styles.card} src={shown.url} alt="" width={1200} height={630} />;
  const pair = shown.pair;
  return (
    <div className={styles.card}>
      {pair === null ? <div className={styles.before} /> : <img className={styles.before} src={pair.before} alt="" />}
      <div className={styles.rule} />
      {pair === null ? <div className={styles.after} /> : <img className={styles.after} src={pair.after} alt="" />}
      <div className={styles.lockup}>
        <Mark className={styles.lockupMark} />
        <svg className={styles.lockupWordmark} viewBox={WORDMARK_SMALL.viewBox} aria-hidden="true" focusable="false">
          <path d={WORDMARK_SMALL.d} />
        </svg>
      </div>
    </div>
  );
}

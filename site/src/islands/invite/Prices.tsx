import { referral } from "../../content/referral.ts";
import { fillPrices, type PriceWords } from "../../lib/prices.ts";
import styles from "./Invite.module.css";

/** The price book's figures. Each carries its sentence too, so the Worker writes the book's into the built page. */
export function Prices({ words }: { words: PriceWords }) {
  return (
    <dl class={styles.prices}>
      {referral.prices.rows.map((row) => (
        <div key={row.what} class={styles.priceRow}>
          <dt>
            <span class={styles.priceWhat}>{row.what}</span>
            <span class={styles.priceNote}>{row.note}</span>
          </dt>
          <dd>
            <span class={styles.priceAmount} data-price={row.amount}>
              {fillPrices(row.amount, words)}
            </span>
            <span class={styles.priceIncl}>{row.incl}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

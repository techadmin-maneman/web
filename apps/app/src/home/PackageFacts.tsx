// A hair system's three facts in a row, as the four hair systems compared draw them (./HairSystemsScreen.tsx) and the
// replacement's choice of hair system repeats them (../booking/steps/TierStep.tsx): what it costs, how long it lasts,
// and its service and how often.

import { DescriptionList } from "@maneman/ui/DescriptionList";
import { rupees } from "@maneman/web-kit/money";
import type { Price } from "../api.ts";
import { hairSystems, includingGst } from "../content.ts";
import styles from "./hair-systems.module.css";

export function PackageFacts(props: {
  /** What the price is of: a first fit, or a replacement. */
  priceTerm: string;
  price: Price | null;
  months: number;
  service: Price | null;
  everyDays: number;
  /** Inside a choice card's label, which holds words alone. */
  inLabel?: boolean;
}) {
  const copy = hairSystems;
  return (
    <DescriptionList
      layout="row"
      inLabel={props.inLabel}
      className={styles.facts}
      items={[
        ...(props.price === null
          ? []
          : [
              {
                term: props.priceTerm,
                details: (
                  <>
                    {rupees(props.price.amount)}
                    <span className={styles.per}>{includingGst}</span>
                  </>
                ),
              },
            ]),
        { term: copy.lasts, details: copy.months(props.months) },
        ...(props.service === null
          ? []
          : [
              {
                term: copy.service,
                details: (
                  <>
                    {rupees(props.service.amount)}
                    <span className={styles.per}>{copy.everyWithGst(props.everyDays)}</span>
                  </>
                ),
              },
            ]),
      ]}
    />
  );
}

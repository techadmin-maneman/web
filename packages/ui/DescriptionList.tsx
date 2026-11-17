// Facts as their names over their values: a record's head, "Status · Fitted", "Mobile · +91 98100 04417", in a row
// that wraps, or a list down the page.
//
//   <DescriptionList items={[{ term: copy.status, details: status }]} />

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./description-list.module.css";

export interface Description {
  readonly term: string;
  readonly details: ReactNode;
}

export function DescriptionList({
  items,
  layout = "row",
  inLabel = false,
  className,
}: {
  readonly items: readonly Description[];
  /** A row that wraps, as a record's head is; or a list, a name beside each value. */
  readonly layout?: "row" | "list";
  /**
   * Inside a label, as a choice card's, which holds words alone: the same facts in spans, read out as the label's
   * words.
   */
  readonly inLabel?: boolean;
  readonly className?: string | undefined;
}) {
  const look = classes(styles.facts, styles[layout], className);
  if (inLabel) {
    return (
      <span className={look}>
        {items.map((item) => (
          <span key={item.term} className={styles.item}>
            <span className={styles.term}>{item.term}</span>
            <span className={styles.details}>{item.details}</span>
          </span>
        ))}
      </span>
    );
  }
  return (
    <dl className={look}>
      {items.map((item) => (
        <div key={item.term} className={styles.item}>
          <dt className={styles.term}>{item.term}</dt>
          <dd className={styles.details}>{item.details}</dd>
        </div>
      ))}
    </dl>
  );
}

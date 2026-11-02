// Figures two to a row inside a panel, each large in the serif over its name: a record's at a glance. The name is
// read before its figure, though drawn beneath it.
//
//   <FigureGrid figures={[{ label: copy.paid, value: rupees(paid) }, { label: copy.due, value: due, tone: "warning" }]} />

import { classes } from "./classes.ts";
import styles from "./figure-grid.module.css";

/** Brass for a figure to look at; the error's red for one past its day. */
export type FigureTone = "plain" | "attention" | "warning";

export interface Figure {
  readonly label: string;
  readonly value: string;
  readonly tone?: FigureTone;
  /** A value that is words, not a figure, as "No hair system fitted": set at the text's size, so it keeps its line. */
  readonly words?: boolean;
}

export function FigureGrid({ figures }: { readonly figures: readonly Figure[] }) {
  return (
    <dl className={styles.grid}>
      {figures.map((figure) => (
        <div key={figure.label} className={styles.figure}>
          <dt className={styles.label}>{figure.label}</dt>
          <dd className={classes(styles.value, styles[figure.tone ?? "plain"], figure.words === true && styles.words)}>
            {figure.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

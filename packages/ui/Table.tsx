// The ops console's table: rows of --ops-row, the
// head's names small and muted over a rule in the text's own ink, and a figure
// set right in figures of one width. A caller's class sets the columns.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./table.module.css";

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={classes(styles.table, className)}>{children}</table>;
}

/** A column of figures, right aligned, as every board sets a count or an amount. */
export const FIGURE = styles.figure;

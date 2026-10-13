// More, folded until asked for: a question and its answer, or a section's detail. The browser's own details and
// summary, in the apps' look, so the keyboard and a screen reader work as they expect.

import type { ReactNode } from "react";
import { classes } from "./classes.ts";
import styles from "./disclosure.module.css";

export function Disclosure({
  summary,
  children,
  open,
  className,
  summaryClassName,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly className?: string;
  /** The summary's place, where the screen sets it apart: its own margin or type. */
  readonly summaryClassName?: string;
}) {
  return (
    <details className={classes(styles.disclosure, className)} open={open}>
      <summary className={classes(styles.summary, summaryClassName)}>{summary}</summary>
      {children}
    </details>
  );
}
